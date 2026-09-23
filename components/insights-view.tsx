"use client";

import { useEffect, useMemo, useState } from "react";
import { ChevronDown, Info } from "lucide-react";
import type { CorrelationResult } from "@/lib/stats/correlate";
import { Badge, Card } from "@/components/ui";
import { ComparisonChart, CorrelationScatter, LagProfile, type PairPoint } from "@/components/charts";
import { cn, describeLag, formatP } from "@/lib/utils";

type MetricInfo = { key: string; label: string; unit: string | null; category: string | null };
type SeriesInput = { key: string; points: [string, number][] };
type ImportanceScores = Record<string, number>;

function correlationId(result: CorrelationResult): string {
  return `${result.a}|${result.b}|${result.lag}`;
}

function pairKey(a: string, b: string): string {
  return [a, b].sort().join("|");
}

// Stable hackathon priorities. The score describes how useful a relationship
// would be if it exists; it does not inspect the observed values or Pearson r.
const HARDCODED_IMPORTANCE: ImportanceScores = {
  [pairKey("steps", "mood")]: 1.0,
  [pairKey("steps", "sleep_duration")]: 0.95,
  [pairKey("sleep_duration", "mood")]: 0.9,
  [pairKey("sleep_duration", "resting_heart_rate")]: 0.85,
  [pairKey("mood", "focus_time")]: 0.8,
  [pairKey("sleep_duration", "focus_time")]: 0.8,
  [pairKey("weather.sunshine", "mood")]: 0.75,

  // Sleep quality and recovery.
  [pairKey("sleep_duration", "sleep_score")]: 0.75,
  [pairKey("sleep_duration", "sleep_efficiency")]: 0.7,
  [pairKey("sleep_score", "mood")]: 0.85,
  [pairKey("sleep_efficiency", "mood")]: 0.85,
  [pairKey("sleep_mental_recovery", "mood")]: 0.95,
  [pairKey("sleep_mental_recovery", "focus_time")]: 0.85,
  [pairKey("sleep_physical_recovery", "mood")]: 0.8,

  // Body composition and cardiovascular signals.
  [pairKey("body_fat_pct", "steps")]: 0.65,
  [pairKey("body_fat_pct", "sleep_duration")]: 0.55,
  [pairKey("body_fat_pct", "resting_heart_rate")]: 0.7,
  [pairKey("body_mass", "steps")]: 0.7,
  [pairKey("body_mass", "sleep_duration")]: 0.6,
  [pairKey("body_mass", "body_fat_pct")]: 0.65,
  [pairKey("body_mass", "resting_heart_rate")]: 0.65,
  [pairKey("heart_rate", "sleep_duration")]: 0.7,
  [pairKey("heart_rate", "mood")]: 0.7,
  [pairKey("heart_rate", "stress")]: 0.85,
  [pairKey("resting_heart_rate", "stress")]: 0.8,

  // Mental state and productivity.
  [pairKey("stress", "mood")]: 0.95,
  [pairKey("stress", "focus_time")]: 0.8,
  [pairKey("stress", "steps")]: 0.75,
  [pairKey("sleep_duration", "stress")]: 0.85,
  [pairKey("sleep_score", "stress")]: 0.85,
  [pairKey("sleep_efficiency", "stress")]: 0.8,
  [pairKey("spotify.listening_minutes", "mood")]: 0.35,
  [pairKey("github.commits", "focus_time")]: 0.35,
};

const IMPORTANT_THRESHOLD = 0.5;

// Give every other relationship a stable low score instead of showing 0.00.
// This is intentionally based only on the two metric names, never on the
// observed correlation value.
function lowImportanceScoreFor(key: string): number {
  let hash = 0;
  for (const character of key) {
    hash = (hash * 31 + character.charCodeAt(0)) >>> 0;
  }
  return (hash % 49 + 1) / 100;
}

function importanceScoreFor(result: CorrelationResult, scores?: ImportanceScores): number {
  const key = pairKey(result.a, result.b);
  return scores?.[key] ?? lowImportanceScoreFor(key);
}

function correlationScoreFor(result: CorrelationResult): number {
  return Math.abs(result.pearson);
}

function finalScoreFor(result: CorrelationResult, scores: ImportanceScores): number {
  return importanceScoreFor(result, scores) * correlationScoreFor(result);
}

function isImportantCorrelation(result: CorrelationResult, scores: ImportanceScores): boolean {
  return importanceScoreFor(result, scores) >= IMPORTANT_THRESHOLD;
}

export function InsightsView({
  results,
  metrics,
  series,
  defaultMinOverlap,
  storageKey,
}: {
  results: CorrelationResult[];
  metrics: MetricInfo[];
  series: SeriesInput[];
  defaultMinOverlap: number;
  storageKey: string;
}) {
  const [tab, setTab] = useState<"findings" | "matrix">("findings");
  const [onlySignificant, setOnlySignificant] = useState(true);
  const [importantOnly, setImportantOnly] = useState(false);
  const [minOverlap, setMinOverlap] = useState(defaultMinOverlap);
  const [focus, setFocus] = useState<string>("");

  const scoringMetrics = useMemo(() => {
    const keys = new Set(results.flatMap((result) => [result.a, result.b]));
    return metrics.filter((metric) => keys.has(metric.key));
  }, [metrics, results]);
  const scores = HARDCODED_IMPORTANCE;

  const importantIds = useMemo(
    () => new Set(results.filter((result) => isImportantCorrelation(result, scores)).map(correlationId)),
    [results, scores],
  );
  const importantMetricKeys = useMemo(
    () => new Set(scoringMetrics.filter((metric) => [...Object.entries(scores)].some(([key, value]) => value >= IMPORTANT_THRESHOLD && key.split("|").includes(metric.key))).map((metric) => metric.key)),
    [scoringMetrics, scores],
  );

  // Keep important findings available after refresh without adding database scope
  // during the hackathon. The key includes the user id so accounts do not share it.
  useEffect(() => {
    if (importantIds.size === 0) return;
    try {
      const stored = JSON.parse(localStorage.getItem(storageKey) ?? "{}");
      const next = stored && typeof stored === "object" ? { ...stored } : {};
      for (const result of results) {
        if (!importantIds.has(correlationId(result))) continue;
        const id = correlationId(result);
        next[id] = {
          ...result,
          importanceScore: importanceScoreFor(result, scores),
          correlationScore: correlationScoreFor(result),
          finalScore: finalScoreFor(result, scores),
          savedAt: next[id]?.savedAt ?? new Date().toISOString(),
        };
      }
      localStorage.setItem(storageKey, JSON.stringify(next));
    } catch {
      // Local storage can be disabled; the visual insight still works normally.
    }
  }, [importantIds, results, scores, storageKey]);

  const byKey = useMemo(
    () => new Map(metrics.map((metric) => [metric.key, metric])),
    [metrics],
  );
  const seriesByKey = useMemo(
    () => new Map(series.map((one) => [one.key, new Map(one.points)])),
    [series],
  );

  /**
   * Each pair is tested at seven shifts, so showing every row would list the
   * same relationship seven times. Keep the strongest shift per pair and offer
   * the rest in the expanded lag profile.
   */
  const bestPerPair = useMemo(() => {
    const best = new Map<string, CorrelationResult>();
    for (const result of results) {
      if (result.n < minOverlap) continue;
      const pairKey = `${result.a}|${result.b}`;
      const incumbent = best.get(pairKey);
      if (!incumbent || Math.abs(result.pearson) > Math.abs(incumbent.pearson)) {
        best.set(pairKey, result);
      }
    }
    return [...best.values()].sort((x, y) => {
      const importantFirst = Number(isImportantCorrelation(y, scores)) - Number(isImportantCorrelation(x, scores));
      return importantFirst || finalScoreFor(y, scores) - finalScoreFor(x, scores) || correlationScoreFor(y) - correlationScoreFor(x);
    });
  }, [results, minOverlap, scores]);

  const filteredBestPerPair = useMemo(
    () =>
      importantOnly
        ? bestPerPair.filter((result) => isImportantCorrelation(result, scores))
        : bestPerPair,
    [bestPerPair, importantOnly, scores],
  );

  const visible = useMemo(
    () =>
      filteredBestPerPair.filter((result) => {
        if (onlySignificant && !result.significant && !isImportantCorrelation(result, scores)) return false;
        if (focus && result.a !== focus && result.b !== focus) return false;
        return true;
      }),
    [filteredBestPerPair, onlySignificant, focus, scores],
  );

  const matrixResults = useMemo(
    () =>
      onlySignificant
        ? filteredBestPerPair.filter(
            (result) => result.significant || isImportantCorrelation(result, scores),
          )
        : filteredBestPerPair,
    [filteredBestPerPair, onlySignificant, scores],
  );

  return (
    <div className="space-y-5">
      {/* Filters in one row above the charts. */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="flex rounded-lg border border-border p-0.5">
          {(["findings", "matrix"] as const).map((value) => (
            <button
              key={value}
              onClick={() => setTab(value)}
              className={cn(
                "rounded-md px-3 py-1 text-sm font-medium capitalize transition-colors",
                tab === value ? "bg-surface-2 text-text" : "text-muted hover:text-text",
              )}
            >
              {value}
            </button>
          ))}
        </div>

        <select
          value={focus}
          onChange={(event) => setFocus(event.target.value)}
          className="rounded-lg border border-border bg-surface px-2.5 py-1.5 text-sm"
          aria-label="Focus on one metric"
        >
          <option value="">All metrics</option>
          {metrics.map((metric) => (
            <option key={metric.key} value={metric.key}>
              {metric.label}
            </option>
          ))}
        </select>

        <label className="flex items-center gap-2 text-sm text-muted">
          min overlap
          <input
            type="range"
            min={10}
            max={90}
            step={1}
            value={minOverlap}
            onChange={(event) => setMinOverlap(Number(event.target.value))}
            className="w-28 accent-[var(--accent)]"
          />
          <span className="tnum w-8 text-text">{minOverlap}d</span>
        </label>

        <label className="flex items-center gap-2 text-sm text-muted">
          <input
            type="checkbox"
            checked={onlySignificant}
            onChange={(event) => setOnlySignificant(event.target.checked)}
            className="size-4 accent-[var(--accent)]"
          />
          significant only
        </label>

        <label className="flex items-center gap-2 text-sm text-muted">
          <input
            type="checkbox"
            checked={importantOnly}
            onChange={(event) => setImportantOnly(event.target.checked)}
            className="size-4 accent-[var(--accent)]"
          />
          important only
        </label>
      </div>

      {tab === "findings" ? (
        <FindingsList
          results={visible}
          byKey={byKey}
          seriesByKey={seriesByKey}
          allResults={results}
          importantIds={importantIds}
          importanceScores={scores}
        />
      ) : (
        <Matrix
          results={matrixResults}
          metrics={metrics}
          focus={focus}
          importantIds={importantIds}
          importantMetricKeys={importantMetricKeys}
          importanceScores={scores}
        />
      )}

      <p className="flex items-start gap-2 text-xs text-muted">
        <Info className="mt-0.5 size-3.5 shrink-0" aria-hidden />
        <span>
          p-values are adjusted with Benjamini–Hochberg across every pair and shift tested, so
          &ldquo;significant&rdquo; already accounts for how many comparisons were run. It still
          does not mean one thing caused the other. Importance is a hard-coded pair score, and
          final score = importance × correlation strength. Other pairs receive a stable low score below 0.50.
        </span>
      </p>
    </div>
  );
}

/* -------------------------------------------------------------------------- */

function FindingsList({
  results,
  byKey,
  seriesByKey,
  allResults,
  importantIds,
  importanceScores,
}: {
  results: CorrelationResult[];
  byKey: Map<string, MetricInfo>;
  seriesByKey: Map<string, Map<string, number>>;
  allResults: CorrelationResult[];
  importantIds: Set<string>;
  importanceScores: ImportanceScores;
}) {
  const [expanded, setExpanded] = useState<string | null>(null);

  if (results.length === 0) {
    return (
      <Card>
        <p className="py-6 text-center text-sm text-muted">
          Nothing clears those filters. Try lowering the minimum overlap, or turning off
          &ldquo;significant only&rdquo; or &ldquo;important only&rdquo; to see more patterns.
        </p>
      </Card>
    );
  }

  return (
    <div className="space-y-2">
      {results.map((result) => {
        const id = `${result.a}|${result.b}|${result.lag}`;
        const open = expanded === id;
        const important = importantIds.has(id);
        const a = byKey.get(result.a);
        const b = byKey.get(result.b);

        return (
          <Card
            key={id}
            className={cn(
              "p-0 [content-visibility:auto] [contain-intrinsic-size:0_80px]",
              important && "insight-important",
              important
                ? "insight-important-surface border-amber-400/70 shadow-[0_0_0_1px_rgba(245,158,11,0.25)]"
                : "insight-muted",
            )}
          >
            <button
              onClick={() => setExpanded(open ? null : id)}
              aria-expanded={open}
              className="flex w-full items-center gap-4 px-5 py-4 text-left"
            >
              <ScoreChip result={result} important={important} importanceScores={importanceScores} />

              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-medium">
                  {a?.label ?? result.a}{" "}
                  <span className="font-normal text-muted">
                    {result.pearson > 0 ? "rises with" : "falls as"}
                  </span>{" "}
                  {b?.label ?? result.b}
                </span>
                <span className="mt-0.5 block text-xs text-muted">
                  {describeLag(result.lag)} · {result.n} days · importance {importanceScoreFor(result, importanceScores).toFixed(2)} · correlation {correlationScoreFor(result).toFixed(2)} · {formatP(result.qValue)}
                </span>
              </span>

              <span className="flex shrink-0 items-center gap-2">
                <Badge
                  tone={important || result.significant ? "accent" : "neutral"}
                  className={important ? "insight-important-badge" : undefined}
                >
                  {important ? "Important!" : result.significant ? "significant" : result.strength}
                </Badge>
                <ChevronDown
                  className={cn("size-4 text-subtle transition-transform", open && "rotate-180")}
                  aria-hidden
                />
              </span>
            </button>

            {open ? (
              <ExpandedPair
                result={result}
                a={a}
                b={b}
                seriesByKey={seriesByKey}
                allResults={allResults}
              />
            ) : null}
          </Card>
        );
      })}
    </div>
  );
}

function ExpandedPair({
  result,
  a,
  b,
  seriesByKey,
  allResults,
}: {
  result: CorrelationResult;
  a: MetricInfo | undefined;
  b: MetricInfo | undefined;
  seriesByKey: Map<string, Map<string, number>>;
  allResults: CorrelationResult[];
}) {
  const pointsA = seriesByKey.get(result.a);
  const pointsB = seriesByKey.get(result.b);

  const paired = useMemo<PairPoint[]>(() => {
    if (!pointsA || !pointsB) return [];
    const out: PairPoint[] = [];
    for (const [date, x] of pointsA) {
      const y = pointsB.get(result.lag === 0 ? date : shiftDate(date, result.lag));
      if (y === undefined) continue;
      out.push({ date, x, y });
    }
    return out;
  }, [pointsA, pointsB, result.lag]);

  const lagProfile = useMemo(
    () =>
      allResults
        .filter((one) => one.a === result.a && one.b === result.b)
        .map((one) => ({ lag: one.lag, pearson: one.pearson, n: one.n }))
        .sort((x, y) => x.lag - y.lag),
    [allResults, result.a, result.b],
  );

  return (
    <div className="space-y-6 border-t border-border px-5 py-5">
      <div className="grid gap-6 lg:grid-cols-2">
        <div>
          <h3 className="mb-2 text-xs font-medium uppercase tracking-wide text-subtle">
            {a?.label} against {b?.label}
            {result.lag !== 0 ? ` (${describeLag(result.lag)})` : ""}
          </h3>
          <CorrelationScatter
            points={paired}
            xLabel={a?.label ?? result.a}
            yLabel={b?.label ?? result.b}
            xUnit={a?.unit}
            yUnit={b?.unit}
          />
        </div>

        <div>
          <h3 className="mb-2 text-xs font-medium uppercase tracking-wide text-subtle">
            Strength at each shift
          </h3>
          <LagProfile points={lagProfile} />
          <dl className="mt-3 grid grid-cols-3 gap-3 text-xs">
            <Detail label="Pearson r" value={result.pearson.toFixed(3)} />
            <Detail label="Spearman ρ" value={result.spearman.toFixed(3)} />
            <Detail label="Adjusted p" value={result.qValue.toFixed(4)} />
          </dl>
        </div>
      </div>

      {pointsA && pointsB ? (
        <div>
          <h3 className="mb-2 text-xs font-medium uppercase tracking-wide text-subtle">
            Over time
          </h3>
          <ComparisonChart
            a={[...pointsA.entries()]}
            b={[...pointsB.entries()]}
            aLabel={a?.label ?? result.a}
            bLabel={b?.label ?? result.b}
          />
        </div>
      ) : null}
    </div>
  );
}

function Detail({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-subtle">{label}</dt>
      <dd className="tnum mt-0.5 font-medium">{value}</dd>
    </div>
  );
}

/* -------------------------------------------------------------------------- */

/** The overview: every pair at a glance, coloured by sign and strength. */
function Matrix({
  results,
  metrics,
  focus,
  importantIds,
  importantMetricKeys,
  importanceScores,
}: {
  results: CorrelationResult[];
  metrics: MetricInfo[];
  focus: string;
  importantIds: Set<string>;
  importantMetricKeys: Set<string>;
  importanceScores: ImportanceScores;
}) {
  const present = useMemo(() => {
    const keys = new Set<string>();
    for (const result of results) {
      keys.add(result.a);
      keys.add(result.b);
    }
    return metrics
      .filter((metric) => keys.has(metric.key))
      .sort(
        (a, b) =>
          Number(importantMetricKeys.has(b.key)) - Number(importantMetricKeys.has(a.key)),
      );
  }, [results, metrics, importantMetricKeys]);

  const lookup = useMemo(() => {
    const map = new Map<string, CorrelationResult>();
    for (const result of results) {
      map.set(`${result.a}|${result.b}`, result);
      map.set(`${result.b}|${result.a}`, result);
    }
    return map;
  }, [results]);

  const shown = focus ? present.filter((m) => m.key === focus || lookup.has(`${focus}|${m.key}`)) : present;

  if (shown.length < 2) {
    return (
      <Card>
        <p className="py-6 text-center text-sm text-muted">Not enough overlapping metrics to plot.</p>
      </Card>
    );
  }

  return (
    <Card className="overflow-x-auto">
      <table className="w-full border-separate border-spacing-0.5 text-xs">
        <caption className="sr-only">
          Correlation matrix. Each cell is the strongest Pearson coefficient found between two
          metrics across shifts of up to three days.
        </caption>
        <thead>
          <tr>
            <th scope="col" className="sticky left-0 z-10 bg-surface" />
            {shown.map((metric) => (
              <th
                key={metric.key}
                scope="col"
                className={cn(
                  "h-24 w-10 align-bottom p-0 font-medium text-muted",
                  importantMetricKeys.has(metric.key) && "insight-important rounded-lg text-amber-600 dark:text-amber-300",
                )}
              >
                <div className="flex h-24 items-end justify-center">
                  <span className="[writing-mode:vertical-rl] rotate-180 whitespace-nowrap pb-1">
                    {importantMetricKeys.has(metric.key) ? `✦ ${metric.label}` : metric.label}
                  </span>
                </div>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {shown.map((row, rowIndex) => (
            <tr key={row.key}>
              <th
                scope="row"
                className="sticky left-0 z-10 bg-surface pr-3 text-right font-medium text-muted whitespace-nowrap"
              >
                {row.label}
              </th>
              {shown.map((column, columnIndex) => {
                // The matrix is symmetric. Keep the upper triangle only so the
                // browser does not calculate and paint the same relationship twice.
                if (rowIndex > columnIndex) {
                  return <td key={column.key} className="h-9 w-10" aria-hidden />;
                }
                if (row.key === column.key) {
                  return (
                    <td key={column.key} className="h-9 w-10 rounded bg-surface-2" aria-hidden />
                  );
                }
                const result = lookup.get(`${row.key}|${column.key}`);
                const important = result ? importantIds.has(correlationId(result)) : false;
                return (
                  <td
                    key={column.key}
                    // The number is in the cell, so colour is reinforcement
                    // rather than the only way to read the value.
                    title={
                      result
                        ? `${row.label} vs ${column.label}: final = ${finalScoreFor(result, importanceScores).toFixed(2)}, importance = ${importanceScoreFor(result, importanceScores).toFixed(2)}, correlation = ${correlationScoreFor(result).toFixed(2)}, ${describeLag(result.lag)}, n = ${result.n}`
                        : `${row.label} vs ${column.label}: not enough overlapping days`
                    }
                    className={cn(
                      "tnum h-9 w-10 rounded text-center font-medium",
                      important && "insight-important ring-2 ring-amber-400 ring-inset",
                    )}
                    style={
                      result
                        ? {
                            background: important
                              ? `linear-gradient(135deg, rgba(245,158,11,0.22), rgba(251,191,36,0.06)), ${cellColor(result.pearson)}`
                              : "var(--viz-mid)",
                            color: important
                              ? Math.abs(result.pearson) > 0.55
                                ? "#ffffff"
                                : "var(--text)"
                              : "var(--text-muted)",
                          }
                        : undefined
                    }
                  >
                    {result ? result.pearson.toFixed(2).replace("0.", ".") : ""}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </Card>
  );
}

/**
 * Diverging fill: one hue per direction, mixed toward a neutral grey at zero.
 * No hue sits at the midpoint, so "no relationship" reads as absence.
 */
function cellColor(r: number): string {
  const pole = r >= 0 ? "var(--viz-pos)" : "var(--viz-neg)";
  const weight = Math.min(Math.abs(r), 1) * 100;
  return `color-mix(in oklab, ${pole} ${weight.toFixed(0)}%, var(--viz-mid))`;
}

function ScoreChip({
  result,
  important,
  importanceScores,
}: {
  result: CorrelationResult;
  important: boolean;
  importanceScores: ImportanceScores;
}) {
  const score = finalScoreFor(result, importanceScores);
  return (
    <span
      className={cn(
        "tnum flex size-14 shrink-0 flex-col items-center justify-center rounded-lg font-semibold",
        important && "insight-important ring-2 ring-amber-400 ring-offset-2 ring-offset-surface",
      )}
      style={{
        background: important
          ? "linear-gradient(135deg, #c2410c 0%, #f97316 48%, #fbbf24 100%)"
          : "var(--viz-mid)",
        color: important ? "#ffffff" : "var(--text)",
      }}
    >
      <span className="text-[9px] uppercase tracking-wider opacity-75">final</span>
      <span className="text-base">{score.toFixed(2)}</span>
    </span>
  );
}

function shiftDate(date: string, days: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}
