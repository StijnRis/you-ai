import { z } from "zod";
import type { ApiAdapter } from "@/lib/adapters/types";
import type { NormalizedEvent } from "@/lib/mapping/apply";
import type { TypeMeta } from "@/lib/mapping/spec";
import { fromWallClock, localDateOf } from "@/lib/events/time";

/**
 * Google Calendar via its secret iCal address (Settings → your calendar →
 * "Secret address in iCal format"). No OAuth app needed, and it works for any
 * calendar that publishes an .ics feed.
 *
 * Timed events only — all-day entries are mostly birthdays and holidays.
 * Recurring events count only their first occurrence (RRULE is not expanded).
 */

const configSchema = z.object({
  icalUrl: z
    .string()
    .transform((url) => url.trim().replace(/^webcal:\/\//i, "https://"))
    .pipe(z.string().url().startsWith("https://")),
  name: z.string().optional(),
});

export type CalendarConfig = z.infer<typeof configSchema>;

const TYPES: Record<string, TypeMeta> = {
  "calendar.events": {
    label: "Calendar events",
    unit: "events",
    valueKind: "numeric",
    aggregation: "count",
    polarity: 0,
    category: "productivity",
    correlatable: true,
  },
  "calendar.event_minutes": {
    label: "Time in calendar events",
    unit: "min",
    valueKind: "duration",
    aggregation: "sum",
    polarity: 0,
    category: "productivity",
    correlatable: true,
    description: "Total minutes of scheduled events that day.",
  },
};

export const calendarAdapter: ApiAdapter<CalendarConfig> = {
  provider: "google-calendar",
  label: "Google Calendar",
  multiple: true,
  description: "Your events per day and time spent in them, from the calendar's secret iCal address.",
  types: TYPES,

  validateConfig(config: unknown): CalendarConfig {
    return configSchema.parse(config);
  },

  async fetch({ config, from, to, timezone }) {
    const response = await fetch(config.icalUrl);
    if (!response.ok) throw new Error(`Calendar feed returned ${response.status}.`);
    const text = await response.text();
    if (!text.includes("BEGIN:VCALENDAR")) throw new Error("That URL is not an iCal feed.");

    const events: NormalizedEvent[] = [];
    for (const vevent of parseEvents(text)) {
      const start = parseDate(vevent.DTSTART, timezone);
      const end = parseDate(vevent.DTEND, timezone);
      if (!start || !end || vevent.STATUS?.value === "CANCELLED") continue;

      const localDate = localDateOf(start, timezone);
      if (localDate < from || localDate > to) continue;

      const minutes = Math.max(0, Math.round((end.getTime() - start.getTime()) / 60_000));
      const summary = vevent.SUMMARY?.value ?? null;
      const base = `gcal:${vevent.UID?.value ?? summary}:${start.toISOString()}`;
      const common = { startedAt: start, endedAt: end, durationS: minutes * 60, localDate, meta: {} };

      events.push(
        { ...common, typeKey: "calendar.events", value: 1, valueText: summary, dedupeKey: `${base}:count` },
        { ...common, typeKey: "calendar.event_minutes", value: minutes, valueText: summary, dedupeKey: `${base}:min` },
      );
    }
    // Google puts the calendar's name in X-WR-CALNAME; use it as the label.
    const name = text.match(/^X-WR-CALNAME:(.+)$/m)?.[1]?.trim().replace(/\\,/g, ",");
    return { events, label: name ? `Google Calendar — ${name}` : undefined };
  },
};

type Prop = { value: string; params: Record<string, string> };

/** Minimal ICS reader: unfolds lines and collects each VEVENT's properties. */
function parseEvents(text: string): Record<string, Prop>[] {
  const lines = text.replace(/\r?\n[ \t]/g, "").split(/\r?\n/);
  const out: Record<string, Prop>[] = [];
  let current: Record<string, Prop> | null = null;

  for (const line of lines) {
    if (line === "BEGIN:VEVENT") current = {};
    else if (line === "END:VEVENT") {
      if (current) out.push(current);
      current = null;
    } else if (current) {
      const colon = line.indexOf(":");
      if (colon < 0) continue;
      const [name, ...rawParams] = line.slice(0, colon).split(";");
      const params = Object.fromEntries(rawParams.map((p) => p.split("=") as [string, string]));
      current[name.toUpperCase()] = { value: line.slice(colon + 1).replace(/\\,/g, ",").replace(/\\n/gi, " "), params };
    }
  }
  return out;
}

/** 20240301T090000Z, or 20240301T090000 with a TZID. All-day dates return null. */
function parseDate(prop: Prop | undefined, fallbackZone: string): Date | null {
  const match = prop?.value.match(/^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})(Z?)$/);
  if (!prop || !match) return null;
  const [, y, mo, d, h, mi, s, z] = match;
  const naive = new Date(Date.UTC(+y, +mo - 1, +d, +h, +mi, +s));
  return z ? naive : fromWallClock(naive, prop.params.TZID ?? fallbackZone);
}
