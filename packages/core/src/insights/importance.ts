import { generateObject } from "ai";
import { z } from "zod";
import { assertModelConfigured, reasoningModel } from "../ai/provider";

/**
 * Ask the model how interesting each metric *pair* is, from the concepts alone
 * (no data is sent). Used to rank correlations on the Insights screen.
 */

const scoreSchema = z.object({
  scores: z.array(
    z.object({
      pairId: z.number().int().nonnegative(),
      score: z.number().min(0).max(1),
    }),
  ),
});

export function pairKey(a: string, b: string): string {
  return [a, b].sort().join("|");
}

const cache = new Map<string, Record<string, number>>();

export async function scoreMetricPairs(
  metrics: { key: string; label: string }[],
): Promise<Record<string, number>> {
  assertModelConfigured();
  const list = metrics.slice(0, 60);
  const pairs = list.flatMap((a, index) =>
    list.slice(index + 1).map((b) => ({ aKey: a.key, aLabel: a.label, bKey: b.key, bLabel: b.label })),
  );
  if (pairs.length === 0) return {};

  const cacheKey = `v2:${JSON.stringify(pairs)}`;
  const cached = cache.get(cacheKey);
  if (cached) return cached;

  const { object } = await generateObject({
    model: reasoningModel(),
    schema: scoreSchema,
    temperature: 0,
    system: `You score the importance of metric pairs for a personal health and productivity analytics dashboard.

Score each pair from 0 to 1 using only the two metric concepts and labels. Do not use measurements, correlation coefficients, sample sizes, dates, or any observed data — none will be provided.

Meaning of the score:
- 1.0: a correlation would be highly useful and actionable to the person.
- 0.5: somewhat useful.
- 0.0: redundant, trivial, or not useful for this dashboard.

Examples:
- steps + mood: high.
- steps + sleep: high.
- workout duration + exercise minutes: 0 because they are redundant and uninteresting together.
- workout calories + workout duration: moderate.

Return exactly one score for every pair. Use the supplied numeric pairId exactly; do not return labels or keys as the id.`,
    prompt: JSON.stringify({ pairs: pairs.map((pair, pairId) => ({ pairId, ...pair })) }),
  });

  const scores: Record<string, number> = {};
  for (const item of object.scores) {
    const pair = pairs[item.pairId];
    if (!pair) continue;
    scores[pairKey(pair.aKey, pair.bKey)] = Math.max(0, Math.min(1, item.score));
  }
  for (const pair of pairs) {
    const key = pairKey(pair.aKey, pair.bKey);
    if (scores[key] === undefined) scores[key] = 0;
  }

  cache.set(cacheKey, scores);
  while (cache.size > 8) {
    const oldest = cache.keys().next().value;
    if (oldest === undefined) break;
    cache.delete(oldest);
  }
  return scores;
}
