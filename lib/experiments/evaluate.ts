import { generateObject, NoObjectGeneratedError } from "ai";
import { z } from "zod";
import { assertModelConfigured, chatModel } from "@/lib/ai/provider";
import { getSettings } from "@/lib/settings";
import type { ExperimentEvaluation } from "@/lib/db/schema";
import type { ExperimentWithReport } from "@/lib/experiments/store";
import { durationOf } from "@/lib/experiments/analyze";

/**
 * "Did it help?", answered once and stored.
 *
 * The statistics are computed before the model is called and handed over as
 * finished numbers — means, percentage change, p-values, adherence. The model
 * is here to read them, not to produce them: asked to eyeball a fortnight of
 * daily values it will confidently invent a trend, whereas given
 * `-12.4%, p = 0.03, 14 days` it reports what is there.
 *
 * It is also told, in the prompt and again in the schema, that "no clear
 * change" is a real and common answer. A verdict generator that always finds
 * something is worse than useless.
 */

const SYSTEM = `You are reading the result of someone's self-experiment and telling them, plainly, whether it worked.

You are given the experiment, its hypothesis, and the statistics already computed for every metric it was judged on: the mean in the baseline window, the mean during the experiment, the percentage change, a Welch t-test p-value, an effect size, and how often the person actually did the thing.

Rules:
- Judge against the hypothesis, not against whatever moved. If the hypothesis was about sleep and steps went up instead, the experiment did not confirm its hypothesis — say so, and mention the steps separately.
- "no_change" and "inconclusive" are expected outcomes. Most one-week experiments show nothing. Never manufacture a result to be encouraging.
- Use "inconclusive" when the data is too thin to say — few days, missing metrics, or poor adherence. Use "no_change" when there was enough data and nothing moved.
- p > 0.05 means the change is not distinguishable from noise. Report the direction if you like, but do not call it an effect.
- Low adherence is the first explanation for a null result. If they did it on half the days, lead with that.
- This is a before/after comparison with no control group. Anything else that changed in those days — season, illness, a holiday — is an equally good explanation. Put that in the caveat, concretely, not as boilerplate.
- Numbers belong in the text. "Deep sleep averaged 52 min, up from 44 (+18%, p = 0.02)" beats "deep sleep improved".
- Write to the person, in second person, in plain language. No headings, no bullet symbols, no markdown.
- headline: one sentence, under 100 characters, the answer itself.
- detail: two or three sentences at most.
- recommendation: what to do now — keep it, drop it, or run it again for longer and why.`;

const evaluationSchema = z.object({
  verdict: z
    .enum(["helped", "no_change", "worsened", "inconclusive"])
    .describe(
      "helped: the hypothesis was supported. worsened: it moved the wrong way. no_change: enough data, nothing moved. inconclusive: too little data or too little adherence to say.",
    ),
  headline: z.string().min(1).max(160),
  detail: z.string().min(1).max(900),
  perMetric: z
    .array(
      z.object({
        metric: z.string().describe("The metric key exactly as given"),
        note: z.string().max(300).describe("One sentence on what this metric did, with the numbers"),
      }),
    )
    .max(8),
  recommendation: z.string().min(1).max(400),
  caveat: z
    .string()
    .max(400)
    .nullable()
    .describe("The most plausible alternative explanation for this result, or null if none stands out"),
});

/** Build the compact, already-computed brief the model reasons over. */
export function briefFor(result: ExperimentWithReport) {
  const { experiment, report, phase, today } = result;
  return {
    title: experiment.title,
    intervention: experiment.intervention,
    hypothesis: experiment.hypothesis,
    ranFrom: experiment.startDate,
    ranTo: experiment.endDate,
    plannedDays: durationOf(experiment),
    phase,
    today,
    adherence: {
      daysElapsed: report.adherence.daysElapsed,
      daysDone: report.adherence.daysDone,
      // Null when they never checked in at all, which is not the same as zero.
      ratePct:
        report.adherence.rate === null ? null : Math.round(report.adherence.rate * 100),
      note:
        report.adherence.rate === null
          ? "No check-ins were recorded, so we cannot tell how often they actually did it."
          : null,
    },
    windows: report.windows,
    metrics: report.outcomes.map((outcome) => ({
      metric: outcome.metric,
      label: outcome.label,
      unit: outcome.unit,
      baselineMean: round(outcome.baseline.mean),
      baselineDays: outcome.baseline.n,
      duringMean: round(outcome.during.mean),
      duringDays: outcome.during.n,
      onProtocolMean: round(outcome.duringOnProtocol?.mean ?? null),
      afterMean: round(outcome.after.mean),
      afterDays: outcome.after.n,
      changePct: round(outcome.changePct),
      afterChangePct: round(outcome.afterChangePct),
      pValue: outcome.pValue === null ? null : Number(outcome.pValue.toPrecision(3)),
      effectSize: round(outcome.effectSize),
      statisticalVerdict: outcome.verdict,
    })),
  };
}

export async function evaluateExperiment(
  result: ExperimentWithReport,
): Promise<ExperimentEvaluation> {
  assertModelConfigured();

  if (result.report.outcomes.length === 0) {
    // Nothing was ever measured, so there is nothing for the model to read.
    return {
      verdict: "inconclusive",
      headline: "This experiment had no metrics attached, so there is nothing to measure.",
      detail:
        "An experiment is judged by comparing tracked metrics before and during it. This one was created without any, so the data cannot say whether it helped.",
      perMetric: [],
      recommendation:
        "Run it again with one or two metrics that would plausibly move, picked from what you already track.",
      caveat: null,
    };
  }

  const settings = await getSettings();
  const brief = briefFor(result);

  try {
    const { object } = await generateObject({
      model: chatModel(settings.chatModel),
      schema: evaluationSchema,
      system: SYSTEM,
      prompt: `Evaluate this experiment:\n\n\`\`\`json\n${JSON.stringify(brief, null, 2)}\n\`\`\``,
      temperature: 0.2,
    });

    return {
      ...object,
      // The model occasionally renames a metric; keep only keys we asked about
      // so the UI can always match a note to a row.
      perMetric: object.perMetric.filter((entry) =>
        brief.metrics.some((metric) => metric.metric === entry.metric),
      ),
    };
  } catch (error) {
    if (NoObjectGeneratedError.isInstance(error)) {
      throw new Error("The model did not return a usable evaluation. Try again.");
    }
    throw error;
  }
}

function round(value: number | null | undefined): number | null {
  if (value === null || value === undefined || !Number.isFinite(value)) return null;
  return Math.round(value * 100) / 100;
}
