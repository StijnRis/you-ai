import { createAnthropic } from "@ai-sdk/anthropic";
import { createGoogleGenerativeAI } from "@ai-sdk/google";
import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import type { LanguageModel } from "ai";
import { AI_PROVIDERS, CHAT_MODEL_OPTIONS, type AiProviderId } from "./models";

export { CHAT_MODEL_OPTIONS } from "./models";

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
  provider: AiProviderId;
  /** Upstream API base URL; empty means the provider's default. */
  baseUrl: string;
  /** The user's key for that provider (BYOK). Later: replaced by a subscription token. */
  aiKey: string | null;
  /** The user's Tavily key for web research (BYOK). */
  tavilyKey: string | null;
  /** Chat model id chosen in settings. */
  chatModel?: string;
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
 * The SDK talks to the worker as if it were the provider; the worker relays to
 * `x-upstream-url`. The SDK sets its own auth header (bearer, x-api-key or
 * x-goog-api-key) from `apiKey`, and the worker passes it through.
 */
function provider(id: string): LanguageModel {
  const current = aiConfig();
  const upstream = (current.baseUrl || AI_PROVIDERS[current.provider].baseUrl).replace(/\/+$/, "");
  const options = {
    baseURL: workerUrl("/ai"),
    apiKey: current.aiKey ?? undefined,
    headers: { "x-upstream-url": upstream },
    fetch: current.fetch,
  };
  switch (current.provider) {
    case "anthropic":
      return createAnthropic(options)(id);
    case "google":
      return createGoogleGenerativeAI(options)(id);
    default:
      return createOpenAICompatible({
        ...options,
        name: "ai",
        // Some providers only return usage for streaming responses when this is enabled.
        includeUsage: true,
        // Most providers support constrained decoding against a JSON schema; without
        // it the model invents its own field names and conversions fail validation.
        supportsStructuredOutputs: true,
      })(id);
  }
}

export const DEFAULT_CHAT_MODEL = CHAT_MODEL_OPTIONS[0].id;

/** Conversation and tool calling. */
export const CHAT_MODEL = () => config?.chatModel || DEFAULT_CHAT_MODEL;

/** Structured extraction (writing conversions). Same model as chat for now. */
export const REASONING_MODEL = () => CHAT_MODEL();

export const chatModel = (override?: string) => provider(override || CHAT_MODEL());

export const reasoningModel = () => provider(REASONING_MODEL());

export function isModelConfigured(): boolean {
  return Boolean(config?.aiKey);
}

export function assertModelConfigured(): void {
  if (!isModelConfigured()) {
    throw new Error("No AI API key yet. Add one in Settings to use the AI features.");
  }
}
