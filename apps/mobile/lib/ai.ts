import { Platform } from "react-native";
import { fetch as expoFetch } from "expo/fetch";
import { configureAi } from "@youai/core/ai/provider";
import { getSettings } from "@youai/core/settings";
import { getKey } from "./keys";

/**
 * Push the current keys, worker URL and model into core's AI client. Called at
 * start-up and whenever Settings change. On native, `expo/fetch` is the fetch
 * that can stream a response body (React Native's built-in one cannot).
 */
export async function refreshAiConfig(): Promise<void> {
  const [settings, nebiusKey, tavilyKey] = await Promise.all([
    getSettings(),
    getKey("nebius"),
    getKey("tavily"),
  ]);
  configureAi({
    workerUrl: settings.workerUrl,
    nebiusKey,
    tavilyKey,
    chatModel: settings.chatModel,
    fetch: Platform.OS === "web" ? undefined : (expoFetch as unknown as typeof globalThis.fetch),
  });
}
