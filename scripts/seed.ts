/**
 * Seeds the built-in conversions, and optionally a demo account with enough
 * plausible data that the Insights and Chat views have something to say.
 *
 *   pnpm db:seed            # conversions only
 *   pnpm db:seed --demo     # plus 180 days of synthetic data for the demo user
 */
import { config } from "dotenv";
config({ path: [".env.local", ".env"], quiet: true });

import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { mappingSpecs, users } from "@/lib/db/schema";
import { builtinSpecs } from "@/lib/mapping/builtin";
import { ingestEvents } from "@/lib/events/ingest";
import { shiftLocalDate, noonOn, weekdayOf } from "@/lib/events/time";
import type { NormalizedEvent } from "@/lib/mapping/apply";
import type { TypeMeta } from "@/lib/mapping/spec";

const DEMO_EMAIL = "demo@youai.local";
const TZ = "Europe/Madrid";

async function seedConversions() {
  for (const spec of builtinSpecs) {
    await db
      .insert(mappingSpecs)
      .values({
        userId: null,
        key: spec.key,
        name: spec.name,
        provider: spec.provider,
        origin: "builtin",
        spec,
      })
      .onConflictDoUpdate({
        target: mappingSpecs.key,
        set: { spec, name: spec.name, provider: spec.provider, updatedAt: new Date() },
      });
  }
  // Fingerprints are learned, not seeded: a built-in picks them up the first
  // time it matches a real file.
  console.log(`Seeded ${builtinSpecs.length} built-in conversions.`);
}

/* -------------------------------------------------------------------------- */

const DEMO_TYPES: Record<string, TypeMeta> = {
  steps: { label: "Steps", unit: "steps", valueKind: "numeric", aggregation: "sum", polarity: 1, category: "activity", correlatable: true },
  sleep_duration: { label: "Sleep", unit: "min", valueKind: "duration", aggregation: "sum", polarity: 1, category: "sleep", correlatable: true },
  resting_heart_rate: { label: "Resting heart rate", unit: "bpm", valueKind: "numeric", aggregation: "avg", polarity: -1, category: "health", correlatable: true },
  mood: { label: "Mood", unit: "/10", valueKind: "numeric", aggregation: "avg", polarity: 1, category: "mood", correlatable: true },
  focus_time: { label: "Focus time", unit: "min", valueKind: "duration", aggregation: "sum", polarity: 1, category: "productivity", correlatable: true },
};

/**
 * Synthetic but not arbitrary: the generator builds in three relationships, so
 * the correlation engine has known answers to find.
 *
 *   sleep  -> next day's mood        (a lag-1 effect)
 *   steps  -> same day's mood        (weaker, same-day)
 *   sleep  -> resting heart rate     (negative)
 *
 * Everything else is noise, which is the point: the multiple-comparison
 * correction should leave the noise out of the Insights list.
 */
function generateDemoData(days: number): NormalizedEvent[] {
  let seed = 20240301;
  const random = () => {
    seed = (seed * 1664525 + 1013904223) % 4294967296;
    return seed / 4294967296;
  };
  const noise = (scale: number) => (random() - 0.5) * 2 * scale;

  const today = new Date();
  const start = shiftLocalDate(today.toISOString().slice(0, 10), -days);
  const events: NormalizedEvent[] = [];
  const sleepByDay: number[] = [];

  for (let i = 0; i < days; i++) {
    const date = shiftLocalDate(start, i);
    const weekend = [0, 6].includes(weekdayOf(date));
    const at = noonOn(date, TZ);

    const sleep = Math.round(
      (weekend ? 480 : 420) + Math.sin(i / 9) * 25 + noise(45),
    );
    sleepByDay.push(sleep);

    const steps = Math.round((weekend ? 11000 : 7600) + Math.sin(i / 5) * 1800 + noise(2600));
    const previousSleep = i > 0 ? sleepByDay[i - 1] : sleep;

    // Mood follows *last night's* sleep, plus a smaller same-day step effect.
    const mood = clamp(
      5.2 + (previousSleep - 450) / 70 + (steps - 8000) / 9000 + noise(0.9),
      1,
      10,
    );
    const restingHr = Math.round(62 - (sleep - 450) / 40 + noise(3));
    const focus = Math.round(clamp(190 + (weekend ? -120 : 0) + (mood - 5) * 22 + noise(60), 0, 520));

    events.push(
      event("steps", at, date, steps),
      event("sleep_duration", at, date, sleep),
      event("mood", at, date, Math.round(mood * 10) / 10),
      event("resting_heart_rate", at, date, restingHr),
      event("focus_time", at, date, focus),
    );
  }

  return events;
}

function event(typeKey: string, at: Date, localDate: string, value: number): NormalizedEvent {
  return {
    typeKey,
    startedAt: at,
    endedAt: null,
    durationS: null,
    value,
    valueText: null,
    localDate,
    meta: { synthetic: true },
    dedupeKey: `demo:${typeKey}:${localDate}`,
  };
}

const clamp = (value: number, min: number, max: number) => Math.min(Math.max(value, min), max);

async function seedDemoData() {
  let [demo] = await db.select().from(users).where(eq(users.email, DEMO_EMAIL)).limit(1);
  if (!demo) {
    [demo] = await db
      .insert(users)
      .values({ email: DEMO_EMAIL, name: "Demo", timezone: TZ })
      .returning();
    console.log("Created the demo user.");
  }

  const events = generateDemoData(180);
  const result = await ingestEvents(demo.id, events, {
    types: new Map(Object.entries(DEMO_TYPES)),
  });

  console.log(
    `Seeded ${result.inserted.toLocaleString()} demo events across ${result.daysTouched} days` +
      (result.dateRange ? ` (${result.dateRange.from} – ${result.dateRange.to}).` : "."),
  );
  console.log("Sign in as the demo user to see them (ALLOW_DEMO_LOGIN=1).");
}

async function main() {
  await seedConversions();
  if (process.argv.includes("--demo")) await seedDemoData();
  process.exit(0);
}

void main();
