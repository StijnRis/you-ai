import { convertToModelMessages, stepCountIs, streamText, type UIMessage } from "ai";
import { assertModelConfigured, chatModel } from "../ai/provider";
import { buildTools } from "../ai/tools";
import { todayFor } from "../experiments/store";

/**
 * The analyst chat, run entirely on device: the model is reached through the
 * worker, but the tools execute here against the local SQLite store, so the
 * person's data only leaves the device as tool results inside the prompt.
 */

const SYSTEM = `You are the analyst for someone's personal data — activity, sleep, mood, weather, media, whatever they have imported.

You have tools that query their event store and run statistics over it. Use them. Never guess at a number, and never answer from memory about what their data contains: call list_metrics first in any new conversation so you are working from the metric keys that actually exist.

How to be useful here:
- Answer with the numbers, and say over how many days. "You averaged 8,200 steps across 96 days" beats "you walk a lot".
- When you report a relationship, give the coefficient, the sample size and whether it survived the multiple-comparison correction. Say plainly when something is not significant.
- Distinguish correlation from causation every time it matters, without turning it into a lecture. One clause is enough.
- A relationship at a lag is worth naming explicitly: "sleep the night before, not the same night".
- If the data cannot answer the question — too few overlapping days, metric not tracked — say so and say what they would need to import.
- Keep it short. A couple of paragraphs, or a short list. No headers on a two-line answer.

Experiments — you also help them run self-experiments: change one thing for a set number of days, then measure what moved.
- When they name a goal ("I want to exercise more", "I want to sleep better"), research it with search_web first: look for concrete, evidence-backed interventions and how large the effects were. One or two focused searches are usually enough.
- Then compare two or three specific experiments, choose the most suitable one, and set it up. For the chosen experiment, define what to do every day, for how many days, which tracked metrics should move and in which direction, and the evidence source.
- When they ask you to design, set up, or run an experiment, manage it end-to-end: inspect their metrics, research a sensible intervention when useful, choose the measurable plan, and call create_experiment immediately. Do not wait for another confirmation unless the request is genuinely ambiguous or unsafe. Target metrics must be keys from list_metrics; if nothing they track could show the effect, say what they would need to start tracking instead of inventing a metric.
- Default to starting today and to 7–14 days — long enough for a signal, short enough to stick to. One change at a time, or the result cannot be attributed to anything.
- After creating one, tell them to check in each day on the Experiments screen. Mention that when it finishes, the Experiments screen will flag it and they can press Evaluate there for the verdict.
- To report on an experiment, call list_experiments and analyze_experiment. Lead with the change in each metric, then the p-value and adherence. Be honest that a before/after comparison with no control group is suggestive, not proof, and that a one-week experiment can easily miss a real but small effect.
- Cite the web sources you used as plain URLs.`;

export type ChatUsage = {
  model: string;
  inputTokens: number | null;
  outputTokens: number | null;
  totalTokens: number | null;
  durationMs: number;
};

/** Stream one assistant turn as UI message chunks, ready for a `useChat` transport. */
export async function streamChat(params: {
  messages: UIMessage[];
  timezone: string;
  model: string;
  abortSignal?: AbortSignal;
}) {
  assertModelConfigured();
  const startedAt = Date.now();

  const result = streamText({
    model: chatModel(params.model),
    system: `${SYSTEM}\n\nToday is ${todayFor(params.timezone)} in their timezone (${params.timezone}).`,
    messages: await convertToModelMessages(params.messages),
    tools: buildTools({ timezone: params.timezone }),
    // Enough hops to list metrics, search the web twice, check a baseline and
    // create an experiment — or to run a correlation and dig into one pair.
    stopWhen: stepCountIs(10),
    temperature: 0.3,
    abortSignal: params.abortSignal,
  });

  return result.toUIMessageStream({
    messageMetadata: ({ part }) => {
      if (part.type !== "finish") return undefined;
      const usage: ChatUsage = {
        model: params.model,
        inputTokens: part.totalUsage.inputTokens ?? null,
        outputTokens: part.totalUsage.outputTokens ?? null,
        totalTokens: part.totalUsage.totalTokens ?? null,
        durationMs: Date.now() - startedAt,
      };
      return { chatEvaluation: usage };
    },
  });
}
