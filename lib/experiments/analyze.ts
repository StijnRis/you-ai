import { compareGroups, type DailySeries, type GroupComparison } from "@/lib/stats/correlate";
import { eachLocalDate, shiftLocalDate } from "@/lib/events/time";

/**
 * Did the experiment move anything?
 *
 * Every target metric is split into three windows of equal length:
 *
 *   baseline  the N days right before the start — how things were
 *   during    the experiment itself, up to today if it is still running
 *   after     the N days after the end — did the effect outlast the habit?
 *
 * Baseline against during is the headline comparison. It is a before/after
 * design with no control group, so a significant change is evidence, not
 * proof: a week of cold showers that happened to coincide with a heatwave will
 * look like it improved sleep. The report says so.
 */

export type ExperimentPhase = "scheduled" | "running" | "finished" | "abandoned";

export function phaseOf(
  experiment: { startDate: string; endDate: string; status: "active" | "abandoned" },
  today: string,
): ExperimentPhase {
  if (experiment.status === "abandoned") return "abandoned";
  if (today < experiment.startDate) return "scheduled";
  if (today <= experiment.endDate) return "running";
  return "finished";
}

/** Inclusive length of the planned experiment, in days. */
export function durationOf(experiment: { startDate: string; endDate: string }): number {
  return eachLocalDate(experiment.startDate, experiment.endDate).length;
}

export type Windows = {
  baseline: { from: string; to: string };
  during: { from: string; to: string } | null;
  after: { from: string; to: string } | null;
};

export function windowsFor(
  experiment: { startDate: string; endDate: string },
  today: string,
): Windows {
  const length = durationOf(experiment);
  const baseline = {
    from: shiftLocalDate(experiment.startDate, -length),
    to: shiftLocalDate(experiment.startDate, -1),
  };

  const duringEnd = today < experiment.endDate ? today : experiment.endDate;
  const during =
    today >= experiment.startDate ? { from: experiment.startDate, to: duringEnd } : null;

  const afterStart = shiftLocalDate(experiment.endDate, 1);
  const afterEnd = shiftLocalDate(experiment.endDate, length);
  const after =
    today >= afterStart ? { from: afterStart, to: today < afterEnd ? today : afterEnd } : null;

  return { baseline, during, after };
}

export type MetricMeta = { label: string; unit: string | null; polarity: number };

export type WindowStats = { n: number; mean: number | null };

export type MetricOutcome = {
  metric: string;
  label: string;
  unit: string | null;
  baseline: WindowStats;
  during: WindowStats;
  /** Only the days the person checked in as having done it. */
  duringOnProtocol: WindowStats | null;
  after: WindowStats;
  /** During vs baseline, as a percentage of the baseline mean. */
  changePct: number | null;
  pValue: number | null;
  /** Cohen's d: the change in standard deviations. */
  effectSize: number | null;
  /** How the after window compares with the baseline — did it stick? */
  afterChangePct: number | null;
  verdict: "improved" | "worsened" | "changed" | "no_clear_change" | "not_enough_data";
};

export type ExperimentReport = {
  windows: Windows;
  adherence: { daysElapsed: number; daysDone: number; rate: number | null };
  outcomes: MetricOutcome[];
};

/** Fewest days per window before a comparison is worth running at all. */
const MIN_DAYS = 3;
const ALPHA = 0.05;

export function analyzeExperiment(input: {
  experiment: { startDate: string; endDate: string };
  today: string;
  series: DailySeries[];
  meta: Map<string, MetricMeta>;
  targetMetrics: string[];
  /** Dates the person reported doing the intervention. */
  doneDates: Set<string>;
}): ExperimentReport {
  const windows = windowsFor(input.experiment, input.today);
  const duringDates = windows.during ? eachLocalDate(windows.during.from, windows.during.to) : [];
  const daysDone = duringDates.filter((date) => input.doneDates.has(date)).length;

  const outcomes = input.targetMetrics.map((metric) => {
    const meta = input.meta.get(metric) ?? { label: metric, unit: null, polarity: 0 };
    const points = input.series.find((one) => one.typeKey === metric)?.points ?? new Map();

    const baseline = valuesIn(points, windows.baseline);
    const during = valuesIn(points, windows.during);
    const after = valuesIn(points, windows.after);
    const onProtocol = windows.during
      ? duringDates.filter((d) => input.doneDates.has(d) && points.has(d)).map((d) => points.get(d)!)
      : [];

    const main = compareGroups(metric, [
      { label: "baseline", values: baseline },
      { label: "during", values: during },
    ]);

    const baselineMean = meanOf(baseline);
    const duringMean = meanOf(during);
    const afterMean = meanOf(after);

    return {
      metric,
      label: meta.label,
      unit: meta.unit,
      baseline: { n: baseline.length, mean: baselineMean },
      during: { n: during.length, mean: duringMean },
      duringOnProtocol:
        input.doneDates.size > 0 ? { n: onProtocol.length, mean: meanOf(onProtocol) } : null,
      after: { n: after.length, mean: afterMean },
      changePct: percentChange(baselineMean, duringMean),
      pValue: main.pValue,
      effectSize: main.effectSize,
      afterChangePct: percentChange(baselineMean, afterMean),
      verdict: verdictFor(baseline.length, during.length, main, meta.polarity),
    } satisfies MetricOutcome;
  });

  return {
    windows,
    adherence: {
      daysElapsed: duringDates.length,
      daysDone,
      rate: input.doneDates.size > 0 && duringDates.length > 0 ? daysDone / duringDates.length : null,
    },
    outcomes,
  };
}

function valuesIn(
  points: Map<string, number>,
  window: { from: string; to: string } | null,
): number[] {
  if (!window) return [];
  const values: number[] = [];
  for (const [date, value] of points) {
    if (date >= window.from && date <= window.to) values.push(value);
  }
  return values;
}

function meanOf(values: number[]): number | null {
  if (values.length === 0) return null;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function percentChange(before: number | null, after: number | null): number | null {
  if (before === null || after === null || before === 0) return null;
  return ((after - before) / Math.abs(before)) * 100;
}

function verdictFor(
  baselineDays: number,
  duringDays: number,
  comparison: GroupComparison,
  polarity: number,
): MetricOutcome["verdict"] {
  if (baselineDays < MIN_DAYS || duringDays < MIN_DAYS) return "not_enough_data";
  if (comparison.pValue === null || comparison.pValue > ALPHA) return "no_clear_change";
  const direction = Math.sign(comparison.effectSize ?? 0);
  if (polarity === 0 || direction === 0) return "changed";
  return direction === polarity ? "improved" : "worsened";
}
