"use client";

import { useMemo, useState } from "react";
import { ChevronDown, Info } from "lucide-react";
import type { CorrelationResult } from "@/lib/stats/correlate";
import { Badge, Card } from "@/components/ui";
import { ComparisonChart, CorrelationScatter, LagProfile, type PairPoint } from "@/components/charts";
import { cn, describeLag, formatP } from "@/lib/utils";

type MetricInfo = { key: string; label: string; unit: string | null; category: string | null };
type SeriesInput = { key: string; points: [string, number][] };

export function InsightsView({
  results,
  metrics,
  series,
}: {
  results: CorrelationResult[];
  metrics: MetricInfo[];
  series: SeriesInput[];
}) {
  const [tab, setTab] = useState<"findings" | "matrix">("findings");
  const [onlySignificant, setOnlySignificant] = useState(true);
  const [minOverlap, setMinOverlap] = useState(21);
  const [focus, setFocus] = useState<string>("");

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
    return [...best.values()].sort((x, y) => Math.abs(y.pearson) - Math.abs(x.pearson));
  }, [results, minOverlap]);

  const visible = useMemo(
    () =>
      bestPerPair.filter((result) => {
        if (onlySignificant && !result.significant) return false;
        if (focus && result.a !== focus && result.b !== focus) return false;
        return true;
      }),
    [bestPerPair, onlySignificant, focus],
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
      </div>

      {tab === "findings" ? (
        <FindingsList
          results={visible}
          byKey={byKey}
          seriesByKey={seriesByKey}
          allResults={results}
        />
      ) : (
        <Matrix results={bestPerPair} metrics={metrics} focus={focus} />
      )}

      <p className="flex items-start gap-2 text-xs text-muted">
        <Info className="mt-0.5 size-3.5 shrink-0" aria-hidden />
        <span>
          p-values are adjusted with Benjamini–Hochberg across every pair and shift tested, so
          &ldquo;significant&rdquo; already accounts for how many comparisons were run. It still
          does not mean one thing caused the other — a third factor, like the season, explains a
          surprising number of these.
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
}: {
  results: CorrelationResult[];
  byKey: Map<string, MetricInfo>;
  seriesByKey: Map<string, Map<string, number>>;
  allResults: CorrelationResult[];
}) {
  const [expanded, setExpanded] = useState<string | null>(null);

  if (results.length === 0) {
    return (
      <Card>
        <p className="py-6 text-center text-sm text-muted">
          Nothing clears those filters. Try lowering the minimum overlap, or turning off
          &ldquo;significant only&rdquo; to see the weaker patterns.
        </p>
      </Card>
    );
  }

  return (
    <div className="space-y-2">
      {results.map((result) => {
        const id = `${result.a}|${result.b}|${result.lag}`;
        const open = expanded === id;
        const a = byKey.get(result.a);
        const b = byKey.get(result.b);

        return (
          <Card key={id} className="p-0">
            <button
              onClick={() => setExpanded(open ? null : id)}
              aria-expanded={open}
              className="flex w-full items-center gap-4 px-5 py-4 text-left"
            >
              <CoefficientChip r={result.pearson} />

              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-medium">
                  {a?.label ?? result.a}{" "}
                  <span className="font-normal text-muted">
                    {result.pearson > 0 ? "rises with" : "falls as"}
                  </span>{" "}
                  {b?.label ?? result.b}
                </span>
                <span className="mt-0.5 block text-xs text-muted">
                  {describeLag(result.lag)} · {result.n} days · {formatP(result.qValue)}
                </span>
              </span>

              <span className="flex shrink-0 items-center gap-2">
                <Badge tone={result.significant ? "accent" : "neutral"}>
                  {result.significant ? "significant" : result.strength}
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
}: {
  results: CorrelationResult[];
  metrics: MetricInfo[];
  focus: string;
}) {
  const present = useMemo(() => {
    const keys = new Set<string>();
    for (const result of results) {
      keys.add(result.a);
      keys.add(result.b);
    }
    return metrics.filter((metric) => keys.has(metric.key));
  }, [results, metrics]);

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
                className="h-24 w-10 align-bottom p-0 font-medium text-muted"
              >
                <div className="flex h-24 items-end justify-center">
                  <span className="[writing-mode:vertical-rl] rotate-180 whitespace-nowrap pb-1">
                    {metric.label}
                  </span>
                </div>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {shown.map((row) => (
            <tr key={row.key}>
              <th
                scope="row"
                className="sticky left-0 z-10 bg-surface pr-3 text-right font-medium text-muted whitespace-nowrap"
              >
                {row.label}
              </th>
              {shown.map((column) => {
                if (row.key === column.key) {
                  return (
                    <td key={column.key} className="h-9 w-10 rounded bg-surface-2" aria-hidden />
                  );
                }
                const result = lookup.get(`${row.key}|${column.key}`);
                return (
                  <td
                    key={column.key}
                    // The number is in the cell, so colour is reinforcement
                    // rather than the only way to read the value.
                    title={
                      result
                        ? `${row.label} vs ${column.label}: r = ${result.pearson.toFixed(2)}, ${describeLag(result.lag)}, n = ${result.n}`
                        : `${row.label} vs ${column.label}: not enough overlapping days`
                    }
                    className="tnum h-9 w-10 rounded text-center font-medium"
                    style={
                      result
                        ? {
                            background: cellColor(result.pearson),
                            color: Math.abs(result.pearson) > 0.55 ? "#ffffff" : "var(--text)",
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

function CoefficientChip({ r }: { r: number }) {
  return (
    <span
      className="tnum flex size-11 shrink-0 items-center justify-center rounded-lg text-sm font-semibold"
      style={{
        background: cellColor(r),
        color: Math.abs(r) > 0.55 ? "#ffffff" : "var(--text)",
      }}
    >
      {r.toFixed(2).replace("0.", ".")}
    </span>
  );
}

function shiftDate(date: string, days: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}
