import { convertToModelMessages, stepCountIs, streamText, type UIMessage } from "ai";
import { getUser } from "@/lib/auth";
import { chatModel, assertModelConfigured } from "@/lib/ai/provider";
import { buildTools } from "@/lib/ai/tools";

export const maxDuration = 60;

const SYSTEM = `You are the analyst for someone's personal data — activity, sleep, mood, weather, media, whatever they have imported.

You have tools that query their event store and run statistics over it. Use them. Never guess at a number, and never answer from memory about what their data contains: call list_metrics first in any new conversation so you are working from the metric keys that actually exist.

How to be useful here:
- Answer with the numbers, and say over how many days. "You averaged 8,200 steps across 96 days" beats "you walk a lot".
- When you report a relationship, give the coefficient, the sample size and whether it survived the multiple-comparison correction. Say plainly when something is not significant.
- Distinguish correlation from causation every time it matters, without turning it into a lecture. One clause is enough.
- A relationship at a lag is worth naming explicitly: "sleep the night before, not the same night".
- If the data cannot answer the question — too few overlapping days, metric not tracked — say so and say what they would need to import.
- Keep it short. A couple of paragraphs, or a short list. No headers on a two-line answer.`;

export async function POST(request: Request) {
  const user = await getUser();
  if (!user) return new Response("Unauthorized", { status: 401 });

  try {
    assertModelConfigured();
  } catch (error) {
    return Response.json({ error: (error as Error).message }, { status: 503 });
  }

  const { messages }: { messages: UIMessage[] } = await request.json();

  const result = streamText({
    model: chatModel(),
    system: SYSTEM,
    messages: await convertToModelMessages(messages),
    tools: buildTools({ userId: user.id, timezone: user.timezone }),
    // Enough hops to list metrics, run a correlation, then dig into one pair.
    stopWhen: stepCountIs(6),
    temperature: 0.3,
  });

  return result.toUIMessageStreamResponse();
}
