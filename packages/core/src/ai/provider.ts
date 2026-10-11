import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import type { LanguageModel } from "ai";

/**
 * Every model call goes through the you-ai worker, never straight to the provider:
 * browsers can't call providers cross-origin, and routing it all through one
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
  /** Upstream API base URL (any OpenAI-compatible endpoint). */
  baseUrl: string;
  /** The user's key for that provider (BYOK). Later: replaced by a subscription token. */
  aiKey: string | null;
  /** The user's Tavily key for web research (BYOK). */
  tavilyKey: string | null;
  /** Chat model id chosen in settings. */
  chatModel: string;
  /** Streaming-capable fetch; on React Native pass `expo/fetch`. */
  fetch?: typeof globalThis.fetch;
};

let config: AiConfig | null = null;

export function configureAi(next: AiConfig): void {
  config = next;
}

export function aiConfig(): AiConfig {
  if (!config) throw new Error("AI is not configured yet. Open Settings and add your AI provider key.");
  return config;
}

export function workerUrl(path: string): string {
  return `${aiConfig().workerUrl.replace(/\/+$/, "")}${path}`;
}

/** Headers the worker uses to decide whose key pays for a request. */
export function authHeaders(): Record<string, string> {
  const key = aiConfig().tavilyKey;
  return key ? { "x-user-key": key } : {};
}

/**
 * Every provider is reached through its OpenAI-compatible endpoint, so the user
 * only supplies URL + key + model (OpenAI, Claude and Gemini all offer one). The
 * SDK talks to the worker as if it were the provider; the worker relays to
 * `x-upstream-url`.
 */
function provider(id: string): LanguageModel {
  const current = aiConfig();
  return createOpenAICompatible({
    name: "ai",
    baseURL: workerUrl("/ai"),
    apiKey: current.aiKey ?? undefined,
    headers: { "x-upstream-url": current.baseUrl.replace(/\/+$/, "") },
    fetch: current.fetch,
    // Some providers only return usage for streaming responses when this is enabled.
    includeUsage: true,
    // Most providers support constrained decoding against a JSON schema; without
    // it the model invents its own field names and conversions fail validation.
    supportsStructuredOutputs: true,
  })(id);
}

/** Conversation and tool calling. */
export const CHAT_MODEL = () => aiConfig().chatModel;

/** Structured extraction (writing conversions). Same model as chat for now. */
export const REASONING_MODEL = () => CHAT_MODEL();

export const chatModel = (override?: string) => provider(override || CHAT_MODEL());

export const reasoningModel = () => provider(REASONING_MODEL());

export function isModelConfigured(): boolean {
  return Boolean(config?.aiKey && config.baseUrl && config.chatModel);
}

export function assertModelConfigured(): void {
  if (!isModelConfigured()) {
    throw new Error("Set an API URL, model and key in Settings to use the AI features.");
  }
}
