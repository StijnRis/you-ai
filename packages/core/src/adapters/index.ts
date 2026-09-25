import type { ApiAdapter } from "./types";
import { weatherAdapter } from "./weather";
import { githubAdapter } from "./github";
import { calendarAdapter } from "./calendar";
import { demoAdapter } from "./demo";
import { spotifyAdapter } from "./spotify";
import { moodAdapter } from "./mood";

/** Every live API adapter, keyed by the provider id stored on `sources`. */
export const apiAdapters: Record<string, ApiAdapter<never>> = {
  [weatherAdapter.provider]: weatherAdapter as ApiAdapter<never>,
  [githubAdapter.provider]: githubAdapter as ApiAdapter<never>,
  [calendarAdapter.provider]: calendarAdapter as ApiAdapter<never>,
  [spotifyAdapter.provider]: spotifyAdapter as ApiAdapter<never>,
  [demoAdapter.provider]: demoAdapter as ApiAdapter<never>,
  [moodAdapter.provider]: moodAdapter as ApiAdapter<never>,
};

export function getAdapter(provider: string) {
  return apiAdapters[provider] ?? null;
}
