/** Providers the user can pick. `baseUrl` is used when the URL setting is empty. */
export const AI_PROVIDERS = {
  "openai-compatible": {
    label: "OpenAI-compatible",
    hint: "OpenAI, OpenRouter, Groq, Together, Nebius, Ollama, ...",
    baseUrl: "https://api.tokenfactory.nebius.com/v1",
  },
  anthropic: { label: "Claude (Anthropic)", hint: "claude-sonnet-4-5, ...", baseUrl: "https://api.anthropic.com/v1" },
  google: { label: "Gemini (Google)", hint: "gemini-2.5-flash, ...", baseUrl: "https://generativelanguage.googleapis.com/v1beta" },
} as const;

export type AiProviderId = keyof typeof AI_PROVIDERS;
export const AI_PROVIDER_IDS = Object.keys(AI_PROVIDERS) as [AiProviderId, ...AiProviderId[]];

export const CHAT_MODEL_OPTIONS = [
  {
    id: "Qwen/Qwen3-235B-A22B-Instruct-2507",
    label: "Qwen3 235B",
  },
  {
    id: "Qwen/Qwen3-30B-A3B-Instruct-2507",
    label: "Qwen3 30B",
  },
  {
    id: "deepseek-ai/DeepSeek-V4-Flash-0731",
    label: "DeepSeek V4 Flash",
  },
] as const;

export type ChatModelId = (typeof CHAT_MODEL_OPTIONS)[number]["id"];

export function isChatModelId(value: unknown): value is ChatModelId {
  return CHAT_MODEL_OPTIONS.some((model) => model.id === value);
}

export function chatModelLabel(id: string): string {
  return CHAT_MODEL_OPTIONS.find((model) => model.id === id)?.label ?? id;
}
