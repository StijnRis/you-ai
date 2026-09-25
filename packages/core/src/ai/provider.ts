import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import { CHAT_MODEL_OPTIONS } from "./models";

export { CHAT_MODEL_OPTIONS } from "./models";

/**
 * Every model call goes through the you-ai worker, never straight to Nebius:
 * browsers can't call Nebius cross-origin, and routing it all through one
 * place means switching from "bring your own key" to a paid subscription later
 * is a worker change, not an app change.
 *
 * Today the user's own key rides along in `x-user-key` and the worker forwards
 * it upstream without storing it. The app calls `configureAi` at start-up and
 * whenever the key or worker URL changes.
 */

export type AiConfig = {
  /** Base URL of the worker, e.g. https://youai-worker.example.workers.dev */
  workerUrl: string;
  /** The user's Nebius key (BYOK). Later: replaced by a subscription token. */
  nebiusKey: string | null;
  /** The user's Tavily key for web research (BYOK). */
  tavilyKey: string | null;
  /** Chat model id chosen in settings. */
  chatModel?: string;
  /** Streaming-capable fetch; on React Native pass `expo/fetch`. */
  fetch?: typeof globalThis.fetch;
};

type Nebius = ReturnType<typeof createOpenAICompatible>;

let config: AiConfig | null = null;
let cached: { signature: string; provider: Nebius } | undefined;

export function configureAi(next: AiConfig): void {
  config = next;
}

export function aiConfig(): AiConfig {
  if (!config) throw new Error("AI is not configured yet. Open Settings and add your Nebius key.");
  return config;
}

export function workerUrl(path: string): string {
  return `${aiConfig().workerUrl.replace(/\/+$/, "")}${path}`;
}

/** Headers the worker uses to decide whose key pays for a request. */
export function authHeaders(kind: "nebius" | "tavily"): Record<string, string> {
  const key = kind === "nebius" ? aiConfig().nebiusKey : aiConfig().tavilyKey;
  return key ? { "x-user-key": key } : {};
}

function provider(): Nebius {
  const current = aiConfig();
  const signature = `${current.workerUrl}|${current.nebiusKey ?? ""}`;
  if (cached?.signature === signature) return cached.provider;

  const instance = createOpenAICompatible({
    name: "nebius",
    baseURL: workerUrl("/ai/v1"),
    headers: authHeaders("nebius"),
    fetch: current.fetch,
    // Nebius only returns usage for streaming responses when this is enabled.
    includeUsage: true,
    /*
     * Nebius supports constrained decoding against a JSON schema. Without this
     * the SDK only asks for "some JSON" and the model invents its own field
     * names — plausible-looking conversions that fail validation every time.
     */
    supportsStructuredOutputs: true,
  });
  cached = { signature, provider: instance };
  return instance;
}

export const DEFAULT_CHAT_MODEL = CHAT_MODEL_OPTIONS[0].id;

/** Conversation and tool calling. */
export const CHAT_MODEL = () => config?.chatModel || DEFAULT_CHAT_MODEL;

/** Structured extraction (writing conversions). Same model as chat for now. */
export const REASONING_MODEL = () => CHAT_MODEL();

export const chatModel = (override?: string) => provider()(override || CHAT_MODEL());

export const reasoningModel = () => provider()(REASONING_MODEL());

export function isModelConfigured(): boolean {
  return Boolean(config?.nebiusKey);
}

export function assertModelConfigured(): void {
  if (!isModelConfigured()) {
    throw new Error("No Nebius API key yet. Add one in Settings to use the AI features.");
  }
}
