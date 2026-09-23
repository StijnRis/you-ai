import { sampleCorrelation, mean, standardDeviation, median } from "simple-statistics";
import tcdf from "@stdlib/stats-base-dists-t-cdf";
import { shiftLocalDate, weekdayOf, WEEKDAY_NAMES } from "@/lib/events/time";

/**
 * The inference engine.
 *
 * Everything here works on daily series — one number per metric per day — which
 * is what `daily_metrics` already stores. Correlating raw events would mean
 * deciding how to align a 7am weigh-in with a 9pm run; collapsing to days makes
 * that decision once, at ingest.
 */

export type DailySeries = {
  typeKey: string;
  /** date (YYYY-MM-DD) -> value */
  points: Map<string, number>;
};

export type CorrelationResult = {
  a: string;
  b: string;
  /**
   * Days b is shifted relative to a. lag 1 means "a today against b tomorrow",
   * which is how you catch a night's sleep showing up in the next day's mood.
   */
  lag: number;
  n: number;
  pearson: number;
  spearman: number;
  pValue: number;
  /** Benjamini–Hochberg adjusted p, accounting for every pair tested. */
  qValue: number;
  significant: boolean;
  /** Pearson r with the sign, rounded, for display. */
  strength: "none" | "weak" | "moderate" | "strong";
};

export type CorrelateOptions = {
  /** Fewest overlapping days before a pair is worth reporting. */
  minOverlap?: number;
  /** Largest shift to test, in days, in both directions. */
  maxLag?: number;
  /** Significance threshold applied to the adjusted p-value. */
  alpha?: number;
  /** Only report pairs involving this metric. */
  focus?: string;
};

const DEFAULTS = { minOverlap: 14, maxLag: 2, alpha: 0.05 };

declare global {
  // Keep the cache across Next dev module reloads and warm server requests.
  var __youaiCorrelationCache: Map<string, CorrelationResult[]> | undefined;
}

function correlationCacheKey(series: DailySeries[], options: CorrelateOptions): string {
  let hash = 2_166_136_261;
  const add = (value: string) => {
    for (let i = 0; i < value.length; i++) {
      hash ^= value.charCodeAt(i);
      hash = Math.imul(hash, 16_777_619);
    }
  };

  add(`${options.minOverlap ?? DEFAULTS.minOverlap}|${options.maxLag ?? DEFAULTS.maxLag}|${options.alpha ?? DEFAULTS.alpha}|${options.focus ?? ""}`);
  for (const one of series) {
    add(one.typeKey);
    for (const [date, value] of one.points) add(`${date}:${value}`);
  }
  return String(hash >>> 0);
}

/**
 * Score every pair of metrics at every lag, then correct for the fact that we
 * just ran hundreds of tests. Without that correction a dashboard of 30 metrics
 * will always show a few "significant" relationships that are pure noise.
 */
export function correlateAll(
  series: DailySeries[],
  options: CorrelateOptions = {},
): CorrelationResult[] {
  const { minOverlap, maxLag, alpha, focus } = { ...DEFAULTS, ...options };
  const cacheKey = correlationCacheKey(series, { minOverlap, maxLag, alpha, focus });
  const cache = (globalThis.__youaiCorrelationCache ??= new Map());
  const cached = cache.get(cacheKey);
  if (cached) return cached;

  const candidates: Omit<CorrelationResult, "qValue" | "significant" | "strength">[] = [];

  for (let i = 0; i < series.length; i++) {
    for (let j = i + 1; j < series.length; j++) {
      const a = series[i];
      const b = series[j];
      if (focus && a.typeKey !== focus && b.typeKey !== focus) continue;

      for (let lag = -maxLag; lag <= maxLag; lag++) {
        const paired = align(a.points, b.points, lag);
        if (paired.length < minOverlap) continue;

        const xs = paired.map((p) => p[0]);
        const ys = paired.map((p) => p[1]);
        if (isConstant(xs) || isConstant(ys)) continue;

        const pearson = sampleCorrelation(xs, ys);
        if (!Number.isFinite(pearson)) continue;

        candidates.push({
          a: a.typeKey,
          b: b.typeKey,
          lag,
          n: paired.length,
          pearson,
          spearman: spearmanCorrelation(xs, ys),
          pValue: pValueFor(pearson, paired.length),
        });
      }
    }
  }

  const output = benjaminiHochberg(candidates, alpha)
    .map((result) => ({ ...result, strength: strengthOf(result.pearson) }))
    .sort((x, y) => Math.abs(y.pearson) - Math.abs(x.pearson));

  cache.set(cacheKey, output);
  while (cache.size > 8) {
    const oldest = cache.keys().next().value;
    if (oldest === undefined) break;
    cache.delete(oldest);
  }
  return output;
}

/** Correlate exactly two metrics across a range of lags. */
export function correlatePair(
  a: DailySeries,
  b: DailySeries,
  options: CorrelateOptions = {},
): CorrelationResult[] {
  return correlateAll([a, b], options);
}

/**
 * Pair up two series on the same day, optionally shifting b forward by `lag`
 * days. Days where either metric is missing are dropped — no interpolation,
 * because a made-up step count would be indistinguishable from a real one.
 */
function align(
  a: Map<string, number>,
  b: Map<string, number>,
  lag: number,
): [number, number][] {
  const pairs: [number, number][] = [];
  for (const [date, valueA] of a) {
    const valueB = b.get(lag === 0 ? date : shiftLocalDate(date, lag));
    if (valueB === undefined) continue;
    pairs.push([valueA, valueB]);
  }
  return pairs;
}

function isConstant(values: number[]): boolean {
  return values.every((v) => v === values[0]);
}

/** Pearson on the ranks — robust to outliers and non-linear-but-monotonic links. */
export function spearmanCorrelation(xs: number[], ys: number[]): number {
  const rankedX = rank(xs);
  const rankedY = rank(ys);
  if (isConstant(rankedX) || isConstant(rankedY)) return 0;
  const r = sampleCorrelation(rankedX, rankedY);
  return Number.isFinite(r) ? r : 0;
}

/** Fractional ranks, averaging ties so repeated values don't bias the result. */
function rank(values: number[]): number[] {
  const indexed = values.map((value, index) => ({ value, index }));
  indexed.sort((p, q) => p.value - q.value);

  const ranks = new Array<number>(values.length);
  let i = 0;
  while (i < indexed.length) {
    let j = i;
    while (j + 1 < indexed.length && indexed[j + 1].value === indexed[i].value) j++;
    const averageRank = (i + j) / 2 + 1;
    for (let k = i; k <= j; k++) ranks[indexed[k].index] = averageRank;
    i = j + 1;
  }
  return ranks;
}

/** Two-tailed p for a correlation, via the usual t transform. */
export function pValueFor(r: number, n: number): number {
  if (n < 3) return 1;
  const clamped = Math.min(Math.max(r, -0.999999), 0.999999);
  const t = clamped * Math.sqrt((n - 2) / (1 - clamped * clamped));
  const p = 2 * (1 - tcdf(Math.abs(t), n - 2));
  return Math.min(Math.max(p, 0), 1);
}

/**
 * Benjamini–Hochberg. Controls the share of false positives among the results
 * we actually surface, which is the right trade-off for exploratory analysis:
 * Bonferroni would be so strict that real effects never show up.
 */
function benjaminiHochberg<T extends { pValue: number }>(
  results: T[],
  alpha: number,
): (T & { qValue: number; significant: boolean })[] {
  const m = results.length;
  if (m === 0) return [];

  const ordered = [...results].sort((x, y) => x.pValue - y.pValue);
  const qValues = new Array<number>(m);

  // Walk from the least significant end, keeping the running minimum, so the
  // adjusted values come out monotone.
  let running = 1;
  for (let i = m - 1; i >= 0; i--) {
    running = Math.min(running, (ordered[i].pValue * m) / (i + 1));
    qValues[i] = running;
  }

  const byResult = new Map<T, { qValue: number; significant: boolean }>();
  ordered.forEach((result, i) => {
    byResult.set(result, { qValue: qValues[i], significant: qValues[i] <= alpha });
  });

  return results.map((result) => ({ ...result, ...byResult.get(result)! }));
}

function strengthOf(r: number): CorrelationResult["strength"] {
  const magnitude = Math.abs(r);
  if (magnitude >= 0.6) return "strong";
  if (magnitude >= 0.4) return "moderate";
  if (magnitude >= 0.2) return "weak";
  return "none";
}

/* -------------------------------------------------------------------------- */
/*  Group comparisons                                                         */
/* -------------------------------------------------------------------------- */

export type GroupComparison = {
  metric: string;
  groups: { label: string; n: number; mean: number; median: number; sd: number }[];
  /** Welch's t between the first two groups, when there are exactly two. */
  tStatistic: number | null;
  pValue: number | null;
  /** Cohen's d — how big the gap is, in standard deviations. */
  effectSize: number | null;
};

/** Split a metric by day of week and compare weekdays against weekends. */
export function compareWeekendVsWeekday(series: DailySeries): GroupComparison {
  const weekday: number[] = [];
  const weekend: number[] = [];
  for (const [date, value] of series.points) {
    const day = weekdayOf(date);
    (day === 0 || day === 6 ? weekend : weekday).push(value);
  }
  return compareGroups(series.typeKey, [
    { label: "Weekdays", values: weekday },
    { label: "Weekends", values: weekend },
  ]);
}

/** Split a metric by day of week, one group per day. */
export function compareByWeekday(series: DailySeries): GroupComparison {
  const buckets = new Map<number, number[]>();
  for (const [date, value] of series.points) {
    const day = weekdayOf(date);
    if (!buckets.has(day)) buckets.set(day, []);
    buckets.get(day)!.push(value);
  }
  // Monday first — nobody thinks of their week as starting on Sunday.
  const order = [1, 2, 3, 4, 5, 6, 0];
  return compareGroups(
    series.typeKey,
    order.map((day) => ({ label: WEEKDAY_NAMES[day], values: buckets.get(day) ?? [] })),
  );
}

/**
 * Split one metric by whether another metric was high or low that day: "how
 * much did I sleep on days I ran 10k+?". Uses terciles, so the comparison is
 * between clearly different days rather than a coin-flip median split.
 */
export function compareByOtherMetric(
  target: DailySeries,
  splitter: DailySeries,
): GroupComparison {
  const overlap: { date: string; targetValue: number; splitValue: number }[] = [];
  for (const [date, targetValue] of target.points) {
    const splitValue = splitter.points.get(date);
    if (splitValue !== undefined) overlap.push({ date, targetValue, splitValue });
  }
  if (overlap.length < 6) {
    return { metric: target.typeKey, groups: [], tStatistic: null, pValue: null, effectSize: null };
  }

  const sorted = [...overlap].sort((x, y) => x.splitValue - y.splitValue);
  const cut = Math.floor(sorted.length / 3);
  const low = sorted.slice(0, cut).map((row) => row.targetValue);
  const high = sorted.slice(sorted.length - cut).map((row) => row.targetValue);

  return compareGroups(target.typeKey, [
    { label: `Low ${splitter.typeKey}`, values: low },
    { label: `High ${splitter.typeKey}`, values: high },
  ]);
}

export function compareGroups(
  metric: string,
  groups: { label: string; values: number[] }[],
): GroupComparison {
  const described = groups
    .filter((group) => group.values.length > 0)
    .map((group) => ({
      label: group.label,
      n: group.values.length,
      mean: mean(group.values),
      median: median(group.values),
      sd: group.values.length > 1 ? standardDeviation(group.values) : 0,
    }));

  const usable = groups.filter((group) => group.values.length > 1);
  if (usable.length !== 2) {
    return { metric, groups: described, tStatistic: null, pValue: null, effectSize: null };
  }

  const [first, second] = usable;
  const welch = welchTTest(first.values, second.values);
  return { metric, groups: described, ...welch };
}

/**
 * Welch's t-test — the unequal-variance version. Weekday and weekend samples
 * are neither the same size nor equally spread, so Student's would be wrong.
 */
function welchTTest(
  a: number[],
  b: number[],
): { tStatistic: number; pValue: number; effectSize: number } {
  const meanA = mean(a);
  const meanB = mean(b);
  const varA = standardDeviation(a) ** 2;
  const varB = standardDeviation(b) ** 2;
  const se = Math.sqrt(varA / a.length + varB / b.length);

  if (se === 0) return { tStatistic: 0, pValue: 1, effectSize: 0 };

  const t = (meanB - meanA) / se;
  // Welch–Satterthwaite degrees of freedom.
  const df =
    (varA / a.length + varB / b.length) ** 2 /
    ((varA / a.length) ** 2 / (a.length - 1) + (varB / b.length) ** 2 / (b.length - 1));

  const pooledSd = Math.sqrt(
    ((a.length - 1) * varA + (b.length - 1) * varB) / (a.length + b.length - 2),
  );

  return {
    tStatistic: t,
    pValue: Math.min(Math.max(2 * (1 - tcdf(Math.abs(t), Math.max(df, 1))), 0), 1),
    effectSize: pooledSd === 0 ? 0 : (meanB - meanA) / pooledSd,
  };
}

/* -------------------------------------------------------------------------- */
/*  Descriptive summaries                                                     */
/* -------------------------------------------------------------------------- */

export type SeriesSummary = {
  typeKey: string;
  n: number;
  mean: number;
  median: number;
  sd: number;
  min: number;
  max: number;
  first: string;
  last: string;
  /** Change per day from a least-squares fit over the whole window. */
  trendPerDay: number;
  /** Mean of the last 7 days against the 7 before that. */
  recentChangePct: number | null;
};

export function summarize(series: DailySeries): SeriesSummary | null {
  const dates = [...series.points.keys()].sort();
  if (dates.length === 0) return null;

  const values = dates.map((date) => series.points.get(date)!);
  const dayNumbers = dates.map((date) => Date.parse(`${date}T00:00:00Z`) / 86_400_000);

  return {
    typeKey: series.typeKey,
    n: values.length,
    mean: mean(values),
    median: median(values),
    sd: values.length > 1 ? standardDeviation(values) : 0,
    min: Math.min(...values),
    max: Math.max(...values),
    first: dates[0],
    last: dates[dates.length - 1],
    trendPerDay: slope(dayNumbers, values),
    recentChangePct: recentChange(dates, series.points),
  };
}

function slope(xs: number[], ys: number[]): number {
  if (xs.length < 2) return 0;
  const meanX = mean(xs);
  const meanY = mean(ys);
  let numerator = 0;
  let denominator = 0;
  for (let i = 0; i < xs.length; i++) {
    numerator += (xs[i] - meanX) * (ys[i] - meanY);
    denominator += (xs[i] - meanX) ** 2;
  }
  return denominator === 0 ? 0 : numerator / denominator;
}

function recentChange(dates: string[], points: Map<string, number>): number | null {
  if (dates.length < 14) return null;
  const recent = dates.slice(-7).map((d) => points.get(d)!);
  const previous = dates.slice(-14, -7).map((d) => points.get(d)!);
  const before = mean(previous);
  if (before === 0) return null;
  return ((mean(recent) - before) / Math.abs(before)) * 100;
}
