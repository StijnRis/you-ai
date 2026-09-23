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
import { shiftLocalDate } from "@/lib/events/time";
import { durationOf, phaseOf } from "@/lib/experiments/analyze";
import {
  changeExperiment,
  createExperiment,
  getExperimentReport,
  listExperiments,
  todayFor,
} from "@/lib/experiments/store";
import { isWebSearchConfigured, searchWeb } from "@/lib/research/tavily";

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

    search_web: tool({
      description:
        "Search the web for evidence-based ways to reach a goal — habits, interventions, what studies found and how big the effect was. Use it before proposing an experiment, so the idea rests on something better than a hunch. Returns page extracts with URLs; cite the URLs you rely on.",
      inputSchema: z.object({
        query: z
          .string()
          .min(3)
          .describe("A focused search query, e.g. 'cold shower effect on sleep quality study'"),
        depth: z
          .enum(["basic", "advanced"])
          .default("basic")
          .describe("advanced is slower but digs further; use it when basic finds nothing solid"),
      }),
      execute: async ({ query, depth }) => {
        if (!isWebSearchConfigured()) {
          return {
            error:
              "Web search is not configured (TAVILY_API_KEY missing). Answer from general knowledge and say so.",
          };
        }
        try {
          return await searchWeb(query, { depth, maxResults: 5 });
        } catch (error) {
          return { error: error instanceof Error ? error.message : String(error) };
        }
      },
    }),

    list_experiments: tool({
      description:
        "List this person's self-experiments — past, running and scheduled — with their dates, phase and the metrics each one is judged on.",
      inputSchema: z.object({}),
      execute: async () => {
        const today = todayFor(ctx.timezone);
        const rows = await listExperiments(ctx.userId);
        return {
          today,
          experiments: rows.map((row) => ({
            id: row.id,
            title: row.title,
            intervention: row.intervention,
            hypothesis: row.hypothesis,
            startDate: row.startDate,
            endDate: row.endDate,
            days: durationOf(row),
            phase: phaseOf(row, today),
            targetMetrics: row.targetMetrics,
            conclusion: row.conclusion,
          })),
        };
      },
    }),

    create_experiment: tool({
      description:
        "Create a self-experiment: one concrete change, done daily for a fixed number of days, judged on metrics already being tracked. The app compares those metrics during the experiment against the same number of days just before it. When the person asks you to design, set up, or run an experiment, manage it end-to-end and call this tool once you have inspected their metrics and selected a sensible measurable plan; do not wait for another confirmation unless the request is genuinely ambiguous or unsafe.",
      inputSchema: z.object({
        title: z.string().min(3).max(80).describe("Short name, e.g. 'Cold showers for a week'"),
        intervention: z
          .string()
          .min(5)
          .describe("Exactly what to do each day, specific enough to tick off: '2–3 minutes of cold water at the end of the morning shower'"),
        hypothesis: z
          .string()
          .min(5)
          .describe("The expected, measurable effect: 'Mood will be higher and resting heart rate lower than in the week before'"),
        rationale: z
          .string()
          .optional()
          .describe("Why this is worth trying — a two- or three-sentence summary of the evidence found"),
        sources: z
          .array(z.object({ title: z.string(), url: z.string().url() }))
          .max(8)
          .default([])
          .describe("The web pages the idea came from, from search_web"),
        targetMetrics: z
          .array(z.string())
          .min(1)
          .max(6)
          .describe("Metric keys from list_metrics that should move if the hypothesis is right"),
        durationDays: z
          .number()
          .int()
          .min(3)
          .max(90)
          .describe("How many days to run it — 7 to 21 is usual"),
        startDate: dateSchema.optional().describe("First day, YYYY-MM-DD. Defaults to today."),
      }),
      execute: async (input) => {
        const known = new Set((await getMetricOverview(ctx.userId)).map((metric) => metric.key));
        const tracked = input.targetMetrics.filter((key) => known.has(key));
        const untracked = input.targetMetrics.filter((key) => !known.has(key));
        if (tracked.length === 0) {
          return {
            error: `None of ${input.targetMetrics.join(", ")} are tracked, so the experiment could not be measured. Pick keys from list_metrics.`,
          };
        }

        const startDate = input.startDate ?? todayFor(ctx.timezone);
        const row = await createExperiment(ctx.userId, {
          title: input.title,
          intervention: input.intervention,
          hypothesis: input.hypothesis,
          rationale: input.rationale,
          sources: input.sources,
          targetMetrics: tracked,
          startDate,
          endDate: shiftLocalDate(startDate, input.durationDays - 1),
          createdBy: "ai",
        });

        return {
          id: row.id,
          title: row.title,
          startDate: row.startDate,
          endDate: row.endDate,
          targetMetrics: row.targetMetrics,
          url: `/experiments/${row.id}`,
          ...(untracked.length
            ? { droppedMetrics: untracked, warning: "These metrics are not tracked and were left out." }
            : {}),
        };
      },
    }),

    analyze_experiment: tool({
      description:
        "Measure an experiment: for each target metric, the mean in the baseline window (the same number of days just before it started), during the experiment, and after it ended, with the % change, a Welch t-test p-value, effect size, and how often the person actually did it.",
      inputSchema: z.object({
        id: z.string().describe("Experiment id from list_experiments"),
      }),
      execute: async ({ id }) => {
        const result = await getExperimentReport(ctx.userId, id, ctx.timezone);
        if (!result) return { error: `No experiment with id "${id}".` };
        return roundAll({
          title: result.experiment.title,
          hypothesis: result.experiment.hypothesis,
          phase: result.phase,
          today: result.today,
          ...result.report,
          note: "Before/after comparison with no control group: anything else that changed in the same days can explain a difference. Short experiments have little statistical power, so 'no clear change' is not proof of no effect.",
        });
      },
    }),

    update_experiment: tool({
      description:
        "Change an experiment's state: end it early (moves the end date to today), abandon it, or record the person's conclusion once it is over.",
      inputSchema: z.object({
        id: z.string(),
        action: z.enum(["end_now", "abandon", "conclude"]),
        conclusion: z
          .string()
          .optional()
          .describe("Required for conclude: what they learned, in a sentence or two"),
      }),
      execute: async ({ id, action, conclusion }) => {
        const row = await changeExperiment(ctx, id, action, conclusion);
        if (!row) return { error: `No experiment with id "${id}".` };
        return {
          id: row.id,
          phase: phaseOf(row, todayFor(ctx.timezone)),
          endDate: row.endDate,
          conclusion: row.conclusion,
        };
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
