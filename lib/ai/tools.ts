import { tool } from "ai";
import { z } from "zod";
import {
  getDailySeries,
  getDataRange,
  getMetricOverview,
  listEvents,
} from "@/lib/db/queries";
import {
  compareByOtherMetric,
  compareByWeekday,
  compareWeekendVsWeekday,
  correlateAll,
  summarize,
  type DailySeries,
} from "@/lib/stats/correlate";

/**
 * The tools the chat uses to answer questions about someone's data.
 *
 * Every tool is scoped to one user by closure. The model never supplies a user
 * id and cannot reach another account's rows, however it is prompted.
 *
 * The tools deliberately return *computed* results — correlations, summaries,
 * group comparisons — rather than raw rows wherever possible. A 70B model
 * asked to eyeball 400 numbers will confabulate a trend; asked to interpret an
 * r of -0.42 over 96 days it does well.
 */

export type ToolContext = { userId: string; timezone: string };

const dateSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "use YYYY-MM-DD")
  .describe("Calendar date as YYYY-MM-DD");

export function buildTools(ctx: ToolContext) {
  return {
    list_metrics: tool({
      description:
        "List every metric this person is tracking, with its unit, how many days of data it has, and its date range. Call this first — metric keys from here are the only valid inputs to the other tools.",
      inputSchema: z.object({}),
      execute: async () => {
        const [metrics, range] = await Promise.all([
          getMetricOverview(ctx.userId),
          getDataRange(ctx.userId),
        ]);
        return {
          timezone: ctx.timezone,
          dataRange: range,
          metrics: metrics.map((metric) => ({
            key: metric.key,
            label: metric.label,
            unit: metric.unit,
            category: metric.category,
            days: metric.days,
            from: metric.firstDate,
            to: metric.lastDate,
            average: round(metric.average),
            latest: round(metric.latestValue),
            aggregation: metric.aggregation,
            correlatable: metric.correlatable,
          })),
        };
      },
    }),

    get_summary: tool({
      description:
        "Descriptive statistics for one metric over a window: mean, median, spread, range, overall trend per day, and how the last 7 days compare with the 7 before.",
      inputSchema: z.object({
        metric: z.string().describe("Metric key from list_metrics"),
        from: dateSchema.optional(),
        to: dateSchema.optional(),
      }),
      execute: async ({ metric, from, to }) => {
        const [series] = await getDailySeries(ctx.userId, { typeKeys: [metric], from, to });
        if (!series) return { error: `No data for metric "${metric}".` };
        const summary = summarize(series);
        if (!summary) return { error: `No data for metric "${metric}" in that window.` };
        return roundAll(summary);
      },
    }),

    get_daily_series: tool({
      description:
        "The raw day-by-day values for one or more metrics. Use only when you need specific dates — for questions about relationships or averages, the dedicated tools are better and cheaper.",
      inputSchema: z.object({
        metrics: z.array(z.string()).min(1).max(4),
        from: dateSchema.optional(),
        to: dateSchema.optional(),
        limit: z.number().int().min(1).max(120).default(60),
      }),
      execute: async ({ metrics, from, to, limit }) => {
        const series = await getDailySeries(ctx.userId, { typeKeys: metrics, from, to });
        return series.map((one) => {
          const dates = [...one.points.keys()].sort().slice(-limit);
          return {
            metric: one.typeKey,
            days: dates.map((date) => ({ date, value: round(one.points.get(date)!) })),
          };
        });
      },
    }),

    find_correlations: tool({
      description:
        "Scan for relationships between metrics. Returns Pearson and Spearman coefficients, sample size, and a p-value already corrected for multiple comparisons. Use `focus` to ask about one metric against everything else. `lag` of 1 means the first metric today against the second tomorrow.",
      inputSchema: z.object({
        focus: z
          .string()
          .optional()
          .describe("Only return pairs involving this metric key"),
        from: dateSchema.optional(),
        to: dateSchema.optional(),
        minOverlap: z.number().int().min(5).max(365).default(14),
        maxLag: z.number().int().min(0).max(7).default(2),
        limit: z.number().int().min(1).max(25).default(12),
        onlySignificant: z.boolean().default(false),
      }),
      execute: async ({ focus, from, to, minOverlap, maxLag, limit, onlySignificant }) => {
        const series = await correlatableSeries(ctx.userId, { from, to });
        if (series.length < 2) {
          return { error: "Need at least two metrics with overlapping days to correlate." };
        }

        let results = correlateAll(series, { focus, minOverlap, maxLag });
        if (onlySignificant) results = results.filter((r) => r.significant);

        return {
          tested: results.length,
          results: results.slice(0, limit).map((result) => ({
            a: result.a,
            b: result.b,
            lag: result.lag,
            n: result.n,
            pearson: round(result.pearson, 3),
            spearman: round(result.spearman, 3),
            pValue: round(result.pValue, 4),
            qValue: round(result.qValue, 4),
            significant: result.significant,
            strength: result.strength,
          })),
          note: "Correlation is not causation, and a significant q-value still means roughly 1 in 20 findings is noise.",
        };
      },
    }),

    compare_groups: tool({
      description:
        "Split one metric into groups and compare them: weekdays vs weekends, each day of the week, or days when another metric was high vs low. Returns group means and a Welch t-test with an effect size.",
      inputSchema: z.object({
        metric: z.string(),
        splitBy: z
          .enum(["weekend", "weekday", "other_metric"])
          .describe("weekend = weekdays vs weekends; weekday = each day separately; other_metric = high vs low days of `splitMetric`"),
        splitMetric: z
          .string()
          .optional()
          .describe("Required when splitBy is other_metric"),
        from: dateSchema.optional(),
        to: dateSchema.optional(),
      }),
      execute: async ({ metric, splitBy, splitMetric, from, to }) => {
        const keys = splitBy === "other_metric" && splitMetric ? [metric, splitMetric] : [metric];
        const series = await getDailySeries(ctx.userId, { typeKeys: keys, from, to });
        const target = series.find((one) => one.typeKey === metric);
        if (!target) return { error: `No data for metric "${metric}".` };

        if (splitBy === "weekend") return roundAll(compareWeekendVsWeekday(target));
        if (splitBy === "weekday") return roundAll(compareByWeekday(target));

        const splitter = series.find((one) => one.typeKey === splitMetric);
        if (!splitter) return { error: "splitBy is other_metric but splitMetric has no data." };
        return roundAll(compareByOtherMetric(target, splitter));
      },
    }),

    list_events: tool({
      description:
        "Individual events behind the daily numbers — useful for explaining an unusual day, or for categorical data like workout types that has no daily average.",
      inputSchema: z.object({
        metrics: z.array(z.string()).min(1).max(4).optional(),
        from: dateSchema.optional(),
        to: dateSchema.optional(),
        limit: z.number().int().min(1).max(100).default(30),
      }),
      execute: async ({ metrics, from, to, limit }) => {
        const rows = await listEvents(ctx.userId, { typeKeys: metrics, from, to, limit });
        return rows.map((row) => ({
          metric: row.typeKey,
          date: row.localDate,
          at: row.startedAt.toISOString(),
          value: round(row.value),
          label: row.valueText,
          durationS: row.durationS,
          meta: row.meta,
        }));
      },
    }),
  };
}

/** Series worth correlating: numeric, flagged correlatable, and long enough. */
async function correlatableSeries(
  userId: string,
  window: { from?: string; to?: string },
): Promise<DailySeries[]> {
  const [overview, series] = await Promise.all([
    getMetricOverview(userId),
    getDailySeries(userId, window),
  ]);
  const usable = new Set(
    overview.filter((metric) => metric.correlatable && metric.valueKind !== "categorical").map((m) => m.key),
  );
  return series.filter((one) => usable.has(one.typeKey));
}

function round(value: number | null | undefined, decimals = 2): number | null {
  if (value === null || value === undefined || !Number.isFinite(value)) return null;
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
}

/** Recursively round every number, so the model isn't fed 14 decimal places. */
function roundAll<T>(value: T): T {
  if (typeof value === "number") return (round(value, 3) as unknown) as T;
  if (Array.isArray(value)) return value.map(roundAll) as unknown as T;
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [key, nested] of Object.entries(value)) out[key] = roundAll(nested);
    return out as T;
  }
  return value;
}
