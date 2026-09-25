import { beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { db, dailyMetrics, events } from "@youai/db";
import { ingestEvents } from "../src/events/ingest";
import { runImport } from "../src/import/run";
import { logMood } from "../src/mood/log";
import { connectSource, disconnectSource } from "../src/adapters/manage";
import { getMetricOverview, listSources } from "../src/db/queries";
import { getSetting, setSetting } from "../src/settings";
import { seedBuiltins } from "../src/seed";
import type { NormalizedEvent } from "../src/mapping/apply";
import type { TypeMeta } from "../src/mapping/spec";
import { fixture, useTestDb } from "./helpers";

const TZ = "Europe/Madrid";
const bytes = (text: string) => new TextEncoder().encode(text);

function event(typeKey: string, iso: string, value: number, dedupeKey: string): NormalizedEvent {
  return { typeKey, startedAt: new Date(iso), endedAt: null, durationS: null, value, valueText: null, localDate: iso.slice(0, 10), meta: {}, dedupeKey };
}

async function dailyValue(typeKey: string, day: string) {
  const rows = await db.select().from(dailyMetrics).where(eq(dailyMetrics.typeKey, typeKey));
  return rows.find((r) => r.localDate === day)?.value;
}

beforeEach(async () => {
  await useTestDb();
});

describe("daily rollup", () => {
  it("collapses each day with the type's own aggregation", async () => {
    const meta = (label: string, aggregation: TypeMeta["aggregation"]): TypeMeta => ({
      label,
      aggregation,
      valueKind: "numeric",
      polarity: 0,
      correlatable: true,
    });
    const types = new Map([
      ["steps", meta("Steps", "sum")],
      ["weight", meta("Weight", "last")],
      ["hr", meta("HR", "avg")],
    ]);
    await ingestEvents(
      [
        event("steps", "2024-03-01T08:00:00Z", 1000, "a"),
        event("steps", "2024-03-01T18:00:00Z", 2500, "b"),
        event("weight", "2024-03-01T07:00:00Z", 71, "c"),
        event("weight", "2024-03-01T21:00:00Z", 72, "d"),
        event("hr", "2024-03-01T07:00:00Z", 50, "e"),
        event("hr", "2024-03-01T23:00:00Z", 60, "f"),
      ],
      { types },
    );
    expect(await dailyValue("steps", "2024-03-01")).toBe(3500);
    expect(await dailyValue("hr", "2024-03-01")).toBe(55);
    expect(await dailyValue("weight", "2024-03-01")).toBe(72); // latest reading wins
  });

  it("updates on re-import instead of duplicating", async () => {
    await ingestEvents([event("steps", "2024-03-01T08:00:00Z", 1000, "a"), event("steps", "2024-03-01T18:00:00Z", 2500, "b")]);
    await ingestEvents([event("steps", "2024-03-01T08:00:00Z", 1111, "a")]);
    expect(await db.select().from(events)).toHaveLength(2);
    expect(await dailyValue("steps", "2024-03-01")).toBe(3611);
  });
});

describe("import pipeline", () => {
  beforeEach(async () => {
    await seedBuiltins();
  });

  it("matches a built-in, stores events, and reuses the conversion by fingerprint", async () => {
    const input = { timezone: TZ, filename: "Daily activity metrics.csv", data: bytes(fixture("google-fit-daily.csv")) };
    const [first] = await runImport(input);
    expect(first.matchKind).toBe("builtin");
    expect(first.stats.eventsStored).toBeGreaterThan(0);

    const [second] = await runImport(input);
    expect(second.matchKind).toBe("fingerprint");
    expect(await db.select().from(events)).toHaveLength(first.stats.eventsStored); // idempotent

    const steps = (await getMetricOverview()).find((m) => m.key === "steps");
    expect(steps).toMatchObject({ days: 5, firstDate: "2024-03-01" });
  });

  it("rejects an unknown format when inference is switched off", async () => {
    await expect(
      runImport({ timezone: TZ, filename: "mood.csv", data: bytes(fixture("unknown-mood.csv")), allowInference: false }),
    ).rejects.toThrow();
  });
});

describe("mood and sources", () => {
  it("logs a manual mood check-in into the daily series", async () => {
    const { localDate } = await logMood({ timezone: TZ, value: 7, at: new Date("2024-03-01T10:00:00Z") });
    expect(await dailyValue("mood", localDate)).toBe(7);
  });

  it("connects sample data, and removes its events on disconnect", async () => {
    const { source, sync, syncError } = await connectSource({ provider: "demo", config: {}, timezone: TZ });
    expect(syncError).toBeUndefined();
    expect(sync!.eventsStored).toBeGreaterThan(1000);
    expect((await listSources())[0].eventCount).toBe(sync!.eventsStored);

    await disconnectSource(source.id);
    expect(await listSources()).toHaveLength(0);
    expect(await db.select().from(events)).toHaveLength(0);
    expect(await db.select().from(dailyMetrics)).toHaveLength(0);
  });
});

describe("settings", () => {
  it("stores valid values and rejects invalid ones", async () => {
    expect(await setSetting("correlationMaxLag", 5)).toBeNull();
    expect(await getSetting("correlationMaxLag")).toBe(5);
    expect(await setSetting("correlationMaxLag", 99)).not.toBeNull();
    expect(await getSetting("correlationMaxLag")).toBe(5);
  });
});
