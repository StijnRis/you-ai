import { useMemo, useState } from "react";
import { Pressable, ScrollView, Switch, Text, View } from "react-native";
import { Link } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { getDailySeries, getDataRange, getMetricOverview } from "@youai/core/db/queries";
import { correlateAll, type CorrelationResult } from "@youai/core/stats/correlate";
import { getSettings } from "@youai/core/settings";
import { describeLag, formatDate, formatP } from "@youai/core/format";
import {
  Badge,
  Button,
  Card,
  cn,
  ComparisonChart,
  CorrelationScatter,
  EmptyState,
  LagProfile,
  Loading,
  SectionHeading,
  useVizPalette,
  type PairPoint,
} from "@youai/ui";
import { Screen } from "../../components/screen";
import { useQuery } from "../../lib/use-query";

type MetricInfo = { key: string; label: string; unit: string | null; category: string | null };
type ImportanceScores = Record<string, number>;

const correlationId = (r: CorrelationResult) => `${r.a}|${r.b}|${r.lag}`;
const pairKey = (a: string, b: string) => [a, b].sort().join("|");

// Stable priorities. The score describes how useful a relationship would be if
// it exists; it never inspects the observed values or Pearson r.
const IMPORTANCE: ImportanceScores = {
  [pairKey("steps", "mood")]: 1.0,
  [pairKey("steps", "sleep_duration")]: 0.95,
  [pairKey("sleep_duration", "mood")]: 0.9,
  [pairKey("sleep_duration", "resting_heart_rate")]: 0.85,
  [pairKey("mood", "focus_time")]: 0.8,
  [pairKey("sleep_duration", "focus_time")]: 0.8,
  [pairKey("weather.sunshine", "mood")]: 0.75,
  [pairKey("sleep_duration", "sleep_score")]: 0.75,
  [pairKey("sleep_duration", "sleep_efficiency")]: 0.7,
  [pairKey("sleep_score", "mood")]: 0.85,
  [pairKey("sleep_efficiency", "mood")]: 0.85,
  [pairKey("sleep_mental_recovery", "mood")]: 0.95,
  [pairKey("sleep_mental_recovery", "focus_time")]: 0.85,
  [pairKey("sleep_physical_recovery", "mood")]: 0.8,
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

/** A stable low score for every other pair, from the names only. */
function lowImportanceScoreFor(key: string): number {
  let hash = 0;
  for (const character of key) hash = (hash * 31 + character.charCodeAt(0)) >>> 0;
  return ((hash % 49) + 1) / 100;
}

const importanceOf = (r: CorrelationResult) => IMPORTANCE[pairKey(r.a, r.b)] ?? lowImportanceScoreFor(pairKey(r.a, r.b));
const finalScoreOf = (r: CorrelationResult) => importanceOf(r) * Math.abs(r.pearson);
const isImportant = (r: CorrelationResult) => importanceOf(r) >= IMPORTANT_THRESHOLD;

async function loadInsights() {
  const [metrics, series, range, settings] = await Promise.all([
    getMetricOverview(),
    getDailySeries(),
    getDataRange(),
    getSettings(),
  ]);
  const correlatable = series.filter((one) => {
    const metric = metrics.find((m) => m.key === one.typeKey);
    return metric?.correlatable && metric.valueKind !== "categorical";
  });
  // Every pair at every lag, once; the filters below only pick what to show.
  const results = correlateAll(correlatable, {
    minOverlap: Math.min(10, settings.correlationMinOverlap),
    maxLag: settings.correlationMaxLag,
    alpha: settings.correlationAlpha,
  });
  return {
    results,
    range,
    settings,
    correlatableCount: correlatable.length,
    metrics: metrics.map((m): MetricInfo => ({ key: m.key, label: m.label, unit: m.unit, category: m.category })),
    seriesByKey: new Map(correlatable.map((one) => [one.typeKey, one.points])),
  };
}

export default function InsightsScreen() {
  const { data, loading } = useQuery(loadInsights);
  if (loading && !data) return <Loading />;
  if (!data || data.correlatableCount < 2) {
    return (
      <Screen tab>
        <SectionHeading title="Insights" />
        <EmptyState
          title="Not enough to correlate yet"
          description="Two metrics with at least a couple of weeks of overlapping days are needed before any relationship means anything. The weather adapter is the quickest way to get a second series."
          action={
            <Link href="/sources" asChild>
              <Button>Connect weather</Button>
            </Link>
          }
        />
      </Screen>
    );
  }
  return (
    <Screen tab>
      <SectionHeading
        title="Insights"
        description={
          data.range
            ? `Every pair of metrics, tested at shifts of up to ${data.settings.correlationMaxLag} days across ${data.range.days} days (${formatDate(data.range.from)} – ${formatDate(data.range.to)}).`
            : undefined
        }
      />
      <InsightsView {...data} defaultMinOverlap={data.settings.correlationMinOverlap} />
    </Screen>
  );
}

function InsightsView({
  results,
  metrics,
  seriesByKey,
  defaultMinOverlap,
}: {
  results: CorrelationResult[];
  metrics: MetricInfo[];
  seriesByKey: Map<string, Map<string, number>>;
  defaultMinOverlap: number;
}) {
  const [tab, setTab] = useState<"findings" | "matrix">("findings");
  const [onlySignificant, setOnlySignificant] = useState(true);
  const [importantOnly, setImportantOnly] = useState(false);
  const [minOverlap, setMinOverlap] = useState(defaultMinOverlap);
  const [focus, setFocus] = useState("");

  const byKey = useMemo(() => new Map(metrics.map((m) => [m.key, m])), [metrics]);

  /** Each pair is tested at several shifts; keep the strongest one per pair. */
  const bestPerPair = useMemo(() => {
    const best = new Map<string, CorrelationResult>();
    for (const result of results) {
      if (result.n < minOverlap) continue;
      const key = `${result.a}|${result.b}`;
      const incumbent = best.get(key);
      if (!incumbent || Math.abs(result.pearson) > Math.abs(incumbent.pearson)) best.set(key, result);
    }
    return [...best.values()]
      .filter((r) => !importantOnly || isImportant(r))
      .sort((x, y) => Number(isImportant(y)) - Number(isImportant(x)) || finalScoreOf(y) - finalScoreOf(x));
  }, [results, minOverlap, importantOnly]);

  const passesSignificance = (r: CorrelationResult) => !onlySignificant || r.significant || isImportant(r);
  const visible = bestPerPair.filter((r) => passesSignificance(r) && (!focus || r.a === focus || r.b === focus));
  const matrixResults = bestPerPair.filter(passesSignificance);
  const focusable = metrics.filter((m) => seriesByKey.has(m.key));

  return (
    <View className="gap-4">
      {/* Filters in one block above the results. */}
      <View className="gap-3">
        <View className="flex-row self-start rounded-lg border border-border p-0.5">
          {(["findings", "matrix"] as const).map((value) => (
            <Pressable key={value} onPress={() => setTab(value)} className={cn("rounded-md px-3 py-1", tab === value && "bg-surface-2")}>
              <Text className={cn("text-sm font-medium capitalize", tab === value ? "text-text" : "text-muted")}>{value}</Text>
            </Pressable>
          ))}
        </View>

        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerClassName="gap-2">
          {[{ key: "", label: "All metrics" }, ...focusable].map((m) => (
            <Pressable
              key={m.key}
              onPress={() => setFocus(m.key)}
              className={cn("rounded-full border px-3 py-1", focus === m.key ? "border-accent bg-accent-soft" : "border-border")}
            >
              <Text className={cn("text-xs", focus === m.key ? "text-accent" : "text-muted")}>{m.label}</Text>
            </Pressable>
          ))}
        </ScrollView>

        <View className="flex-row flex-wrap items-center gap-x-5 gap-y-2">
          <View className="flex-row items-center gap-2">
            <Text className="text-sm text-muted">min overlap</Text>
            <Stepper value={minOverlap} onChange={setMinOverlap} min={10} max={90} step={5} suffix="d" />
          </View>
          <Toggle label="significant only" value={onlySignificant} onChange={setOnlySignificant} />
          <Toggle label="important only" value={importantOnly} onChange={setImportantOnly} />
        </View>
      </View>

      {tab === "findings" ? (
        <FindingsList results={visible} byKey={byKey} seriesByKey={seriesByKey} allResults={results} />
      ) : (
        <Matrix results={matrixResults} metrics={metrics} focus={focus} />
      )}

      <View className="flex-row gap-2">
        <Ionicons name="information-circle-outline" size={14} color="#a8a29e" />
        <Text className="flex-1 text-xs text-muted">
          p-values are adjusted with Benjamini–Hochberg across every pair and shift tested, so “significant” already
          accounts for how many comparisons were run. It still does not mean one thing caused the other. Final score =
          importance × correlation strength.
        </Text>
      </View>
    </View>
  );
}

function Toggle({ label, value, onChange }: { label: string; value: boolean; onChange: (v: boolean) => void }) {
  return (
    <View className="flex-row items-center gap-2">
      <Switch value={value} onValueChange={onChange} />
      <Text className="text-sm text-muted">{label}</Text>
    </View>
  );
}

function Stepper(props: { value: number; onChange: (v: number) => void; min: number; max: number; step: number; suffix?: string }) {
  const { value, onChange, min, max, step, suffix = "" } = props;
  return (
    <View className="flex-row items-center rounded-lg border border-border">
      <Pressable className="px-2.5 py-1" onPress={() => onChange(Math.max(min, value - step))}>
        <Text className="text-text">−</Text>
      </Pressable>
      <Text className="w-10 text-center text-sm text-text">
        {value}
        {suffix}
      </Text>
      <Pressable className="px-2.5 py-1" onPress={() => onChange(Math.min(max, value + step))}>
        <Text className="text-text">+</Text>
      </Pressable>
    </View>
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
        <Text className="py-6 text-center text-sm text-muted">
          Nothing clears those filters. Try lowering the minimum overlap, or turning off “significant only” or
          “important only”.
        </Text>
      </Card>
    );
  }

  return (
    <View className="gap-2">
      {results.slice(0, 100).map((result) => {
        const id = correlationId(result);
        const open = expanded === id;
        const important = isImportant(result);
        const a = byKey.get(result.a);
        const b = byKey.get(result.b);
        return (
          <Card key={id} className={cn("p-0", important ? "border-amber-400" : "bg-surface-2")}>
            <Pressable onPress={() => setExpanded(open ? null : id)} className="flex-row items-center gap-3 p-4">
              <View className={cn("size-14 items-center justify-center rounded-lg", important ? "bg-orange-500" : "bg-surface")}>
                <Text className={cn("text-[9px] uppercase tracking-wider", important ? "text-white" : "text-muted")}>final</Text>
                <Text className={cn("text-base font-semibold", important ? "text-white" : "text-text")}>
                  {finalScoreOf(result).toFixed(2)}
                </Text>
              </View>
              <View className="flex-1">
                <Text className="text-sm font-medium text-text" numberOfLines={2}>
                  {a?.label ?? result.a}{" "}
                  <Text className="font-normal text-muted">{result.pearson > 0 ? "rises with" : "falls as"}</Text>{" "}
                  {b?.label ?? result.b}
                </Text>
                <Text className="mt-0.5 text-xs text-muted">
                  {describeLag(result.lag)} · {result.n} days · r {result.pearson.toFixed(2)} · {formatP(result.qValue)}
                </Text>
              </View>
              <Badge tone={important || result.significant ? "accent" : "neutral"}>
                {important ? "Important!" : result.significant ? "significant" : result.strength}
              </Badge>
            </Pressable>
            {open ? <ExpandedPair result={result} a={a} b={b} seriesByKey={seriesByKey} allResults={allResults} /> : null}
          </Card>
        );
      })}
    </View>
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
      if (y !== undefined) out.push({ date, x, y });
    }
    return out;
  }, [pointsA, pointsB, result.lag]);

  const lagProfile = allResults
    .filter((one) => one.a === result.a && one.b === result.b)
    .map((one) => ({ lag: one.lag, pearson: one.pearson, n: one.n }))
    .sort((x, y) => x.lag - y.lag);

  return (
    <View className="gap-6 border-t border-border p-4">
      <View>
        <Heading>
          {a?.label} against {b?.label}
          {result.lag !== 0 ? ` (${describeLag(result.lag)})` : ""}
        </Heading>
        <CorrelationScatter points={paired} xLabel={a?.label ?? result.a} yLabel={b?.label ?? result.b} xUnit={a?.unit} yUnit={b?.unit} />
      </View>
      <View>
        <Heading>Strength at each shift</Heading>
        <LagProfile points={lagProfile} />
        <View className="mt-3 flex-row gap-3">
          <Detail label="Pearson r" value={result.pearson.toFixed(3)} />
          <Detail label="Spearman ρ" value={result.spearman.toFixed(3)} />
          <Detail label="Adjusted p" value={result.qValue.toFixed(4)} />
        </View>
      </View>
      {pointsA && pointsB ? (
        <View>
          <Heading>Over time</Heading>
          <ComparisonChart a={[...pointsA.entries()]} b={[...pointsB.entries()]} aLabel={a?.label ?? result.a} bLabel={b?.label ?? result.b} />
        </View>
      ) : null}
    </View>
  );
}

function Heading({ children }: { children: React.ReactNode }) {
  return <Text className="mb-2 text-xs font-medium uppercase tracking-wide text-subtle">{children}</Text>;
}

function Detail({ label, value }: { label: string; value: string }) {
  return (
    <View className="flex-1">
      <Text className="text-xs text-subtle">{label}</Text>
      <Text className="mt-0.5 text-xs font-medium text-text">{value}</Text>
    </View>
  );
}

/* -------------------------------------------------------------------------- */

/** The overview: every pair at a glance, coloured by sign and strength, number in the cell. */
function Matrix({ results, metrics, focus }: { results: CorrelationResult[]; metrics: MetricInfo[]; focus: string }) {
  const colors = useVizPalette();
  const lookup = useMemo(() => {
    const map = new Map<string, CorrelationResult>();
    for (const r of results) {
      map.set(`${r.a}|${r.b}`, r);
      map.set(`${r.b}|${r.a}`, r);
    }
    return map;
  }, [results]);

  const present = metrics.filter((m) => results.some((r) => r.a === m.key || r.b === m.key));
  const shown = focus ? present.filter((m) => m.key === focus || lookup.has(`${focus}|${m.key}`)) : present;

  if (shown.length < 2) {
    return (
      <Card>
        <Text className="py-6 text-center text-sm text-muted">Not enough overlapping metrics to plot.</Text>
      </Card>
    );
  }

  const mid = colors.surface === "#ffffff" ? "#f0efec" : "#383835";
  return (
    <Card>
      <ScrollView horizontal>
        <View className="gap-0.5">
          {shown.map((row, rowIndex) => (
            <View key={row.key} className="flex-row items-center gap-0.5">
              <Text className="w-32 pr-2 text-right text-xs font-medium text-muted" numberOfLines={1}>
                {row.label}
              </Text>
              {shown.map((column, columnIndex) => {
                // Symmetric: keep the upper triangle only.
                if (rowIndex > columnIndex) return <View key={column.key} className="h-9 w-11" />;
                if (row.key === column.key) return <View key={column.key} className="h-9 w-11 rounded bg-surface-2" />;
                const r = lookup.get(`${row.key}|${column.key}`);
                return (
                  <View
                    key={column.key}
                    className="h-9 w-11 items-center justify-center rounded"
                    style={{ backgroundColor: r ? mixHex(r.pearson >= 0 ? colors.pos : colors.neg, mid, Math.abs(r.pearson)) : undefined }}
                  >
                    <Text className={cn("text-xs font-medium", r && Math.abs(r.pearson) > 0.55 ? "text-white" : "text-text")}>
                      {r ? r.pearson.toFixed(2).replace("0.", ".") : ""}
                    </Text>
                  </View>
                );
              })}
            </View>
          ))}
          <View className="flex-row gap-0.5">
            <View className="w-32" />
            {shown.map((column) => (
              <Text key={column.key} className="w-11 text-center text-[9px] text-muted" numberOfLines={2}>
                {column.label}
              </Text>
            ))}
          </View>
        </View>
      </ScrollView>
    </Card>
  );
}

/** Diverging fill: one hue per direction, mixed toward a neutral grey at zero. */
function mixHex(pole: string, mid: string, weight: number): string {
  const parse = (hex: string) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
  const [p, m] = [parse(pole), parse(mid)];
  const w = Math.min(Math.max(weight, 0), 1);
  return `rgb(${p.map((c, i) => Math.round(c * w + m[i] * (1 - w))).join(",")})`;
}

function shiftDate(date: string, days: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}
