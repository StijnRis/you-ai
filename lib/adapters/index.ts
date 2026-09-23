import type { ApiAdapter } from "@/lib/adapters/types";
import { weatherAdapter } from "@/lib/adapters/weather";
import { githubAdapter } from "@/lib/adapters/github";
import { calendarAdapter } from "@/lib/adapters/calendar";

/** Every live API adapter, keyed by the provider id stored on `sources`. */
export const apiAdapters: Record<string, ApiAdapter<never>> = {
  [weatherAdapter.provider]: weatherAdapter as ApiAdapter<never>,
  [githubAdapter.provider]: githubAdapter as ApiAdapter<never>,
  [calendarAdapter.provider]: calendarAdapter as ApiAdapter<never>,
};

export function getAdapter(provider: string) {
  return apiAdapters[provider] ?? null;
}
