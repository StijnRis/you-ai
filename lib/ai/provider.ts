import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import { CHAT_MODEL_OPTIONS } from "@/lib/ai/models";

export { CHAT_MODEL_OPTIONS } from "@/lib/ai/models";

/**
 * Nebius Token Factory speaks the OpenAI wire format, so the generic
 * openai-compatible provider is all that's needed — no bespoke client.
 *
 * The client is built on first use rather than at import. Reading the API key
 * at module scope captures whatever was set when the module first loaded,
 * which is empty in any script that calls dotenv after its imports (ESM hoists
 * them) and unreliable in serverless cold starts.
 */

type Nebius = ReturnType<typeof createOpenAICompatible>;

let cached: { key: string; provider: Nebius } | undefined;

function provider(): Nebius {
  const apiKey = process.env.NEBIUS_API_KEY ?? "";
  // Rebuild if the key changed, so a script that loads .env late still works.
  if (cached?.key === apiKey) return cached.provider;

  const instance = createOpenAICompatible({
    name: "nebius",
    baseURL: process.env.NEBIUS_BASE_URL ?? "https://api.tokenfactory.nebius.com/v1/",
    apiKey,
    // Nebius only returns usage for streaming responses when this is enabled.
    includeUsage: true,
    /*
     * Nebius supports constrained decoding against a JSON schema. Without this
     * the SDK only asks for "some JSON" and the model invents its own field
     * names — plausible-looking conversions that fail validation every time.
     */
    supportsStructuredOutputs: true,
  });
  cached = { key: apiKey, provider: instance };
  return instance;
}

export const DEFAULT_CHAT_MODEL = CHAT_MODEL_OPTIONS[0].id;

/** Conversation and tool calling. */
export const CHAT_MODEL = () => process.env.NEBIUS_CHAT_MODEL || DEFAULT_CHAT_MODEL;

/**
 * Structured extraction (writing conversions). Defaults to the chat model, but
 * split so it can be pointed at a stronger one without touching the chat path.
 */
export const REASONING_MODEL = () =>
  process.env.NEBIUS_REASONING_MODEL || CHAT_MODEL();

/** `override` comes from the admin settings, falling back to the env default. */
export const chatModel = (override?: string) => provider()(override || CHAT_MODEL());

export const reasoningModel = () => provider()(REASONING_MODEL());

export function assertModelConfigured(): void {
  if (!process.env.NEBIUS_API_KEY) {
    throw new Error(
      "NEBIUS_API_KEY is not set. Add it to .env.local — see .env.example for the full list.",
    );
  }
}
