import { z } from "zod";
import type { ApiAdapter } from "@/lib/adapters/types";
import type { NormalizedEvent } from "@/lib/mapping/apply";
import type { TypeMeta } from "@/lib/mapping/spec";
import { noonOn } from "@/lib/events/time";

/**
 * Weather via Open-Meteo — the proof of concept for the direct-API adapter.
 *
 * Chosen deliberately: no OAuth, no API key, no rate limit worth worrying
 * about, and a genuine free historical archive. That makes it the one adapter
 * that works the moment the app boots, which is what you want from the example
 * everything else is modelled on.
 */

const configSchema = z.object({
  latitude: z.number().min(-90).max(90),
  longitude: z.number().min(-180).max(180),
  /** Shown in the UI; Open-Meteo itself only needs the coordinates. */
  placeName: z.string().optional(),
});

export type WeatherConfig = z.infer<typeof configSchema>;

const TYPES: Record<string, TypeMeta> = {
  "weather.temp_max": {
    label: "Max temperature",
    unit: "°C",
    valueKind: "numeric",
    aggregation: "max",
    polarity: 0,
    category: "environment",
    correlatable: true,
    description: "Highest air temperature for the day, 2m above ground.",
  },
  "weather.temp_min": {
    label: "Min temperature",
    unit: "°C",
    valueKind: "numeric",
    aggregation: "min",
    polarity: 0,
    category: "environment",
    correlatable: true,
  },
  "weather.precipitation": {
    label: "Precipitation",
    unit: "mm",
    valueKind: "numeric",
    aggregation: "sum",
    polarity: 0,
    category: "environment",
    correlatable: true,
  },
  "weather.sunshine": {
    label: "Sunshine",
    unit: "min",
    valueKind: "duration",
    aggregation: "sum",
    polarity: 1,
    category: "environment",
    correlatable: true,
    description: "Minutes of direct sunshine — often the strongest driver of mood in the data.",
  },
  "weather.wind_max": {
    label: "Max wind speed",
    unit: "km/h",
    valueKind: "numeric",
    aggregation: "max",
    polarity: 0,
    category: "environment",
    correlatable: true,
  },
  "weather.daylight": {
    label: "Daylight",
    unit: "min",
    valueKind: "duration",
    aggregation: "max",
    polarity: 1,
    category: "environment",
    correlatable: true,
  },
};

/** Open-Meteo daily variable -> our event type, with any unit conversion. */
const VARIABLES: {
  apiField: string;
  typeKey: string;
  convert?: (value: number) => number;
}[] = [
  { apiField: "temperature_2m_max", typeKey: "weather.temp_max" },
  { apiField: "temperature_2m_min", typeKey: "weather.temp_min" },
  { apiField: "precipitation_sum", typeKey: "weather.precipitation" },
  { apiField: "sunshine_duration", typeKey: "weather.sunshine", convert: (s) => s / 60 },
  { apiField: "wind_speed_10m_max", typeKey: "weather.wind_max" },
  { apiField: "daylight_duration", typeKey: "weather.daylight", convert: (s) => s / 60 },
];

const ARCHIVE_URL = "https://archive-api.open-meteo.com/v1/archive";
const FORECAST_URL = "https://api.open-meteo.com/v1/forecast";

/**
 * The archive lags real time by about five days. Anything more recent has to
 * come from the forecast endpoint, which also serves the recent past.
 */
const ARCHIVE_LAG_DAYS = 5;

export const weatherAdapter: ApiAdapter<WeatherConfig> = {
  provider: "open-meteo",
  label: "Weather",
  description:
    "Daily weather for one location from Open-Meteo's free historical archive. No account or API key needed.",
  types: TYPES,

  validateConfig(config: unknown): WeatherConfig {
    return configSchema.parse(config);
  },

  async fetch({ config, from, to, timezone }): Promise<NormalizedEvent[]> {
    const cutoff = isoDaysAgo(ARCHIVE_LAG_DAYS);
    const windows: { url: string; from: string; to: string }[] = [];

    if (from < cutoff) {
      windows.push({ url: ARCHIVE_URL, from, to: minDate(to, cutoff) });
    }
    if (to >= cutoff) {
      windows.push({ url: FORECAST_URL, from: maxDate(from, cutoff), to });
    }

    const events: NormalizedEvent[] = [];
    for (const window of windows) {
      events.push(...(await fetchWindow(config, window, timezone)));
    }
    return events;
  },
};

async function fetchWindow(
  config: WeatherConfig,
  window: { url: string; from: string; to: string },
  timezone: string,
): Promise<NormalizedEvent[]> {
  const params = new URLSearchParams({
    latitude: String(config.latitude),
    longitude: String(config.longitude),
    start_date: window.from,
    end_date: window.to,
    daily: VARIABLES.map((v) => v.apiField).join(","),
    // Asking Open-Meteo to bucket by the user's timezone keeps its idea of a
    // day identical to ours, so nothing needs re-bucketing on arrival.
    timezone,
  });

  const response = await fetch(`${window.url}?${params}`, {
    headers: { accept: "application/json" },
  });
  if (!response.ok) {
    const body = await response.text().catch(() => "");
    throw new Error(`Open-Meteo returned ${response.status}: ${body.slice(0, 200)}`);
  }

  const payload = (await response.json()) as {
    daily?: { time?: string[] } & Record<string, (number | null)[] | string[] | undefined>;
  };
  const daily = payload.daily;
  const days = daily?.time;
  if (!daily || !Array.isArray(days)) return [];

  const events: NormalizedEvent[] = [];
  for (let i = 0; i < days.length; i++) {
    const localDate = days[i];
    const startedAt = noonOn(localDate, timezone);

    for (const variable of VARIABLES) {
      const column = daily[variable.apiField];
      if (!Array.isArray(column)) continue;
      const raw = column[i];
      if (raw === null || raw === undefined || typeof raw !== "number") continue;

      const value = variable.convert ? variable.convert(raw) : raw;
      events.push({
        typeKey: variable.typeKey,
        startedAt,
        endedAt: null,
        durationS: null,
        value: Math.round(value * 100) / 100,
        valueText: null,
        localDate,
        meta: {},
        // One reading per metric per day per location — re-syncing an already
        // covered range overwrites rather than duplicates.
        dedupeKey: `open-meteo:${config.latitude},${config.longitude}:${variable.typeKey}:${localDate}`,
      });
    }
  }
  return events;
}

function isoDaysAgo(days: number): string {
  const date = new Date();
  date.setUTCDate(date.getUTCDate() - days);
  return date.toISOString().slice(0, 10);
}

const minDate = (a: string, b: string) => (a < b ? a : b);
const maxDate = (a: string, b: string) => (a > b ? a : b);

export const apiAdapters = { "open-meteo": weatherAdapter } as const;

export function getAdapter(provider: string) {
  return apiAdapters[provider as keyof typeof apiAdapters] ?? null;
}
