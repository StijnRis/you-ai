/**
 * Web search via Tavily, which returns cleaned page extracts rather than raw
 * HTML — short enough to hand straight to the model as a tool result.
 *
 * https://docs.tavily.com/documentation/api-reference/endpoint/search
 */

const ENDPOINT = "https://api.tavily.com/search";

export type WebSearchResult = {
  answer: string | null;
  results: { title: string; url: string; content: string; score: number }[];
};

export function isWebSearchConfigured(): boolean {
  return Boolean(process.env.TAVILY_API_KEY);
}

export async function searchWeb(
  query: string,
  options: { maxResults?: number; depth?: "basic" | "advanced" } = {},
): Promise<WebSearchResult> {
  const apiKey = process.env.TAVILY_API_KEY;
  if (!apiKey) {
    throw new Error("TAVILY_API_KEY is not set. Add it to .env.local to enable web research.");
  }

  const response = await fetch(ENDPOINT, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      query,
      search_depth: options.depth ?? "basic",
      max_results: options.maxResults ?? 5,
      include_answer: true,
    }),
    signal: AbortSignal.timeout(20_000),
  });

  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    throw new Error(`Tavily search failed (${response.status}): ${detail.slice(0, 200)}`);
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
