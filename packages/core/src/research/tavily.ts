import { aiConfig, authHeaders, workerUrl } from "../ai/provider";

/**
 * Web search via Tavily, relayed by the worker (Tavily has no browser CORS and
 * the key must not be baked into a public bundle). Tavily returns cleaned page
 * extracts — short enough to hand straight to the model as a tool result.
 */

export type WebSearchResult = {
  answer: string | null;
  results: { title: string; url: string; content: string; score: number }[];
};

export function isWebSearchConfigured(): boolean {
  try {
    return Boolean(aiConfig().tavilyKey);
  } catch {
    return false;
  }
}

export async function searchWeb(
  query: string,
  options: { maxResults?: number; depth?: "basic" | "advanced" } = {},
): Promise<WebSearchResult> {
  if (!isWebSearchConfigured()) {
    throw new Error("No Tavily API key yet. Add one in Settings to enable web research.");
  }

  const response = await fetch(workerUrl("/search"), {
    method: "POST",
    headers: { "content-type": "application/json", ...authHeaders("tavily") },
    body: JSON.stringify({
      query,
      search_depth: options.depth ?? "basic",
      max_results: options.maxResults ?? 5,
      include_answer: true,
    }),
  });

  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    throw new Error(`Web search failed (${response.status}): ${detail.slice(0, 200)}`);
  }

  const payload = (await response.json()) as {
    answer?: string | null;
    results?: { title?: string; url?: string; content?: string; score?: number }[];
  };

  return {
    answer: payload.answer ?? null,
    results: (payload.results ?? [])
      .filter((result) => result.url)
      .map((result) => ({
        title: result.title ?? result.url!,
        url: result.url!,
        // Extracts can run long; the model needs the gist, not the page.
        content: (result.content ?? "").slice(0, 800),
        score: result.score ?? 0,
      })),
  };
}
