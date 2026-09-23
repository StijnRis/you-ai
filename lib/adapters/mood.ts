import { z } from "zod";
import type { ApiAdapter } from "@/lib/adapters/types";
import type { NormalizedEvent } from "@/lib/mapping/apply";
import type { TypeMeta } from "@/lib/mapping/spec";
import { eachLocalDate, fromWallClock, shiftLocalDate, weekdayOf } from "@/lib/events/time";
import { MOOD_TYPE_KEY, MOOD_TYPE_META } from "@/lib/mood/types";

/**
 * A stand-in for a real mood-tracking service, connected like any other API
 * source so the connector flow is visible end to end without a provider to
 * sign up for.
 *
 * Two readings a day rather than one, because that is what a real tracker
 * feeds us — and it exercises the `avg` aggregation on the way into the daily
 * rollup instead of every day being a single number.
 *
 * Deterministic: every reading is a pure function of its date and slot, so a
 * re-sync of the same range rewrites identical values through the dedupe keys.
 * Weekends and a slow multi-week swell are built in so the charts and the
 * weekday stats have something real to find.
 */

const TYPES: Record<string, TypeMeta> = { [MOOD_TYPE_KEY]: MOOD_TYPE_META };

/** Hour of the local day each reading is stamped at. */
const SLOTS = [
  { name: "morning", hour: 9 },
  { name: "evening", hour: 21 },
] as const;

export const moodAdapter: ApiAdapter<Record<string, never>> = {
  provider: "mood-tracker",
  label: "Fake mood feed",
  description:
    "A simulated mood feed: two check-ins a day on a 1-10 scale. Connect it to see mood alongside your other data, or log your own on the Mood page.",
  types: TYPES,

  validateConfig(config: unknown) {
    return z.object({}).strict().parse(config ?? {}) as Record<string, never>;
  },

  async fetch({ from, to, timezone }): Promise<NormalizedEvent[]> {
    const events: NormalizedEvent[] = [];

    for (const date of eachLocalDate(from, to)) {
      for (const slot of SLOTS) {
        const [y, m, d] = date.split("-").map(Number);
        const at = fromWallClock(new Date(Date.UTC(y, m - 1, d, slot.hour, 0, 0)), timezone);

        events.push({
          typeKey: MOOD_TYPE_KEY,
          startedAt: at,
          endedAt: null,
          durationS: null,
          value: readingFor(date, slot.name),
          valueText: null,
          localDate: date,
          meta: { synthetic: true, slot: slot.name },
          dedupeKey: `mood-tracker:${MOOD_TYPE_KEY}:${date}:${slot.name}`,
        });
      }
    }

    return events;
  },
};

/**
 * One check-in, on a 1-10 scale. The shape: a weekly rhythm (Mondays dip,
 * weekends lift), a slow swell across several weeks so longer ranges are not
 * flat, evenings a little above mornings, and per-reading jitter on top.
 */
function readingFor(date: string, slot: string): number {
  const weekday = weekdayOf(date);
  const index = Date.parse(`${date}T00:00:00Z`) / 86_400_000;

  const weekly = [0.6, -0.7, -0.2, 0.1, 0.3, 0.8, 0.9][weekday];
  const swell = Math.sin(index / 11) * 0.7;
  const evening = slot === "evening" ? 0.35 : 0;
  const jitter = (hash(`${date}:${slot}`) - 0.5) * 1.6;

  // Yesterday leaves a trace on today — a mood series with no autocorrelation
  // at all reads as noise, and the lag is what Insights looks for.
  const yesterday = shiftLocalDate(date, -1);
  const carry = (hash(`${yesterday}:evening`) - 0.5) * 0.5;

  const value = 6.4 + weekly + swell + evening + jitter + carry;
  return Math.round(clamp(value, 1, 10) * 10) / 10;
}

/** Deterministic 0..1 from a string (FNV-1a). */
function hash(input: string): number {
  let h = 2166136261;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0) / 4294967296;
}

const clamp = (value: number, min: number, max: number) => Math.min(Math.max(value, min), max);
