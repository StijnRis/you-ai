import { generateObject } from "ai";
import { z } from "zod";
import { getUser } from "@/lib/auth";
import { assertModelConfigured, reasoningModel } from "@/lib/ai/provider";

export const maxDuration = 30;

const requestSchema = z.object({
  metrics: z
    .array(z.object({ key: z.string().min(1), label: z.string().min(1) }))
    .min(2)
    .max(60),
});

const scoreSchema = z.object({
  scores: z.array(
    z.object({
      pairId: z.number().int().nonnegative(),
      score: z.number().min(0).max(1),
    }),
  ),
});

declare global {
  var __youaiImportanceCache: Map<string, Record<string, number>> | undefined;
}

function pairKey(a: string, b: string): string {
  return [a, b].sort().join("|");
}

export async function POST(request: Request) {
  const user = await getUser();
  if (!user) return new Response("Unauthorized", { status: 401 });

  try {
    assertModelConfigured();
    const input = requestSchema.parse(await request.json());
    const pairs = input.metrics.flatMap((a, index) =>
      input.metrics.slice(index + 1).map((b) => ({
        aKey: a.key,
        aLabel: a.label,
        bKey: b.key,
        bLabel: b.label,
      })),
    );
    const cacheKey = `v2:${JSON.stringify(pairs)}`;
    const cache = (globalThis.__youaiImportanceCache ??= new Map());
    const cached = cache.get(cacheKey);
    if (cached) return Response.json({ scores: cached });

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
      prompt: JSON.stringify({
        pairs: pairs.map((pair, pairId) => ({ pairId, ...pair })),
      }),
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
    return Response.json({ scores });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not score metric importance.";
    return Response.json({ error: message }, { status: 400 });
  }
}
