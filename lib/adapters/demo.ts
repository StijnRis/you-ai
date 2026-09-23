import { z } from "zod";
import type { ApiAdapter } from "@/lib/adapters/types";
import type { NormalizedEvent } from "@/lib/mapping/apply";
import type { TypeMeta } from "@/lib/mapping/spec";
import { eachLocalDate, noonOn, shiftLocalDate, weekdayOf } from "@/lib/events/time";

/**
 * Sample data, connected like any other source so people can try the app
 * without an export to hand — and remove it again with one click.
 *
 * Synthetic but not arbitrary: three relationships are built in so Insights
 * has known answers to find.
 *
 *   sleep -> next day's mood     (a lag-1 effect)
 *   steps -> same day's mood     (weaker)
 *   sleep -> resting heart rate  (negative)
 *
 * Every value is a pure function of its date, so re-syncing a range produces
 * the same numbers and the dedupe keys simply overwrite.
 */

const TYPES: Record<string, TypeMeta> = {
  steps: { label: "Steps", unit: "steps", valueKind: "numeric", aggregation: "sum", polarity: 1, category: "activity", correlatable: true },
  sleep_duration: { label: "Sleep", unit: "min", valueKind: "duration", aggregation: "sum", polarity: 1, category: "sleep", correlatable: true },
  resting_heart_rate: { label: "Resting heart rate", unit: "bpm", valueKind: "numeric", aggregation: "avg", polarity: -1, category: "health", correlatable: true },
  mood: { label: "Mood", unit: "/10", valueKind: "numeric", aggregation: "avg", polarity: 1, category: "mood", correlatable: true },
  focus_time: { label: "Focus time", unit: "min", valueKind: "duration", aggregation: "sum", polarity: 1, category: "productivity", correlatable: true },
};

export const demoAdapter: ApiAdapter<Record<string, never>> = {
  provider: "demo",
  label: "Sample data",
  description: "Realistic made-up steps, sleep, mood, heart rate and focus time, so you can explore the app before connecting anything real.",
  types: TYPES,

  validateConfig(config: unknown) {
    return z.object({}).strict().parse(config ?? {}) as Record<string, never>;
  },

  async fetch({ from, to, timezone }): Promise<NormalizedEvent[]> {
    const events: NormalizedEvent[] = [];
    for (const date of eachLocalDate(from, to)) {
      const day = dayValues(date);
      const at = noonOn(date, timezone);
      for (const [typeKey, value] of Object.entries(day)) {
        events.push({
          typeKey,
          startedAt: at,
          endedAt: null,
          durationS: null,
          value,
          valueText: null,
          localDate: date,
          meta: { synthetic: true },
          dedupeKey: `demo:${typeKey}:${date}`,
        });
      }
    }
    return events;
  },
};

function dayValues(date: string) {
  const weekend = [0, 6].includes(weekdayOf(date));
  const index = Date.parse(`${date}T00:00:00Z`) / 86_400_000;
  const noise = (salt: string, scale: number) => (hash(`${date}:${salt}`) - 0.5) * 2 * scale;

  const sleep = sleepOn(date);
  const previousSleep = sleepOn(shiftLocalDate(date, -1));
  const steps = Math.round((weekend ? 11000 : 7600) + Math.sin(index / 5) * 1800 + noise("steps", 2600));
  const mood = clamp(5.2 + (previousSleep - 450) / 70 + (steps - 8000) / 9000 + noise("mood", 0.9), 1, 10);
  const restingHr = Math.round(62 - (sleep - 450) / 40 + noise("hr", 3));
  const focus = Math.round(clamp(190 + (weekend ? -120 : 0) + (mood - 5) * 22 + noise("focus", 60), 0, 520));

  return {
    steps,
    sleep_duration: sleep,
    mood: Math.round(mood * 10) / 10,
    resting_heart_rate: restingHr,
    focus_time: focus,
  };
}

function sleepOn(date: string): number {
  const weekend = [0, 6].includes(weekdayOf(date));
  const index = Date.parse(`${date}T00:00:00Z`) / 86_400_000;
  return Math.round((weekend ? 480 : 420) + Math.sin(index / 9) * 25 + (hash(`${date}:sleep`) - 0.5) * 90);
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
