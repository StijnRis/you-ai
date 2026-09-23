import { createOpenAICompatible } from "@ai-sdk/openai-compatible";

/**
 * Nebius Token Factory speaks the OpenAI wire format, so the generic
 * openai-compatible provider is all that's needed — no bespoke client.
 */
const baseURL = process.env.NEBIUS_BASE_URL ?? "https://api.tokenfactory.nebius.com/v1/";

export const nebius = createOpenAICompatible({
  name: "nebius",
  baseURL,
  apiKey: process.env.NEBIUS_API_KEY ?? "",
});

/** Conversation and tool calling. */
export const CHAT_MODEL = process.env.NEBIUS_CHAT_MODEL ?? "meta-llama/Meta-Llama-3.1-70B-Instruct";

/**
 * Structured extraction (writing conversions). Same default as chat, but split
 * so it can be pointed at a stronger model without touching the chat path.
 */
export const REASONING_MODEL = process.env.NEBIUS_REASONING_MODEL ?? CHAT_MODEL;

export const chatModel = () => nebius(CHAT_MODEL);
export const reasoningModel = () => nebius(REASONING_MODEL);

export function assertModelConfigured(): void {
  if (!process.env.NEBIUS_API_KEY) {
    throw new Error(
      "NEBIUS_API_KEY is not set. Add it to .env.local — see .env.example for the full list.",
    );
  }
}
