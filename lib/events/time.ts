/**
 * Timezone handling for the event store.
 *
 * Every event is stamped with the calendar day it belongs to *in the user's
 * own timezone*. Doing this once at ingest means every day-bucketed query is a
 * plain equality check, and a 23:30 workout never lands on the wrong day
 * because the server happens to run in UTC.
 */

const dateFormatters = new Map<string, Intl.DateTimeFormat>();

function formatterFor(timeZone: string): Intl.DateTimeFormat {
  let formatter = dateFormatters.get(timeZone);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat("en-CA", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    });
    dateFormatters.set(timeZone, formatter);
  }
  return formatter;
}

/** The YYYY-MM-DD that `instant` falls on, as seen from `timeZone`. */
export function localDateOf(instant: Date, timeZone: string): string {
  try {
    // en-CA formats as YYYY-MM-DD, which is exactly the shape we store.
    return formatterFor(timeZone).format(instant);
  } catch {
    return formatterFor("UTC").format(instant);
  }
}

/**
 * Read a UTC offset out of the shapes exports actually write it in:
 * "UTC+0100", "GMT-0500", "+01:00", "-05", or a bare number of minutes.
 * Returns minutes east of UTC, or null if it is not an offset at all.
 */
export function parseUtcOffset(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  if (typeof value === "number") return Number.isFinite(value) ? value : null;

  const text = String(value).trim();
  // A bare number is already minutes — "60", "-300".
  if (/^[+-]?\d{1,4}$/.test(text)) {
    const minutes = Number(text);
    return Math.abs(minutes) <= 16 * 60 ? minutes : null;
  }

  const match = text.match(/^(?:UTC|GMT)?\s*([+-])(\d{2}):?(\d{2})?$/i);
  if (!match) return null;
  const [, sign, hours, mins] = match;
  const total = Number(hours) * 60 + Number(mins ?? "0");
  if (total > 16 * 60) return null;
  return sign === "-" ? -total : total;
}

/** The YYYY-MM-DD an instant falls on for someone at a fixed UTC offset. */
export function localDateAtOffset(instant: Date, offsetMinutes: number): string {
  return new Date(instant.getTime() + offsetMinutes * 60_000).toISOString().slice(0, 10);
}

/** Offset of `timeZone` from UTC, in minutes, at a given instant. */
function offsetMinutes(instant: Date, timeZone: string): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hour12: false,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).formatToParts(instant);

  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value ?? "0");
  const asUtc = Date.UTC(
    get("year"),
    get("month") - 1,
    get("day"),
    get("hour") % 24,
    get("minute"),
    get("second"),
  );
  return (asUtc - instant.getTime()) / 60_000;
}

/**
 * Interpret a naive timestamp (one with no zone, as most dumps contain) as
 * wall-clock time in `timeZone`.
 */
export function fromWallClock(naive: Date, timeZone: string): Date {
  try {
    // One pass gets within an hour; the second settles DST boundaries.
    const first = new Date(naive.getTime() - offsetMinutes(naive, timeZone) * 60_000);
    return new Date(naive.getTime() - offsetMinutes(first, timeZone) * 60_000);
  } catch {
    return naive;
  }
}

/** Midday on a calendar day, far enough from midnight to survive zone shifts. */
export function noonOn(localDate: string, timeZone: string): Date {
  const [y, m, d] = localDate.split("-").map(Number);
  return fromWallClock(new Date(Date.UTC(y, m - 1, d, 12, 0, 0)), timeZone);
}

/** Calendar days from `from` to `to` inclusive, as YYYY-MM-DD strings. */
export function eachLocalDate(from: string, to: string): string[] {
  const out: string[] = [];
  const cursor = new Date(`${from}T00:00:00Z`);
  const end = new Date(`${to}T00:00:00Z`);
  while (cursor <= end) {
    out.push(cursor.toISOString().slice(0, 10));
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return out;
}

/** Shift a YYYY-MM-DD by whole days without touching timezones. */
export function shiftLocalDate(localDate: string, days: number): string {
  const d = new Date(`${localDate}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** 0 = Sunday, matching Date#getUTCDay. */
export function weekdayOf(localDate: string): number {
  return new Date(`${localDate}T00:00:00Z`).getUTCDay();
}

export const WEEKDAY_NAMES = [
  "Sunday",
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
] as const;
