import { describe, expect, it } from "vitest";
import { detectFile, scoreSpec } from "../src/mapping/detect";
import { builtinSpecs, ignoreReasonFor } from "../src/mapping/builtin/index";
import { applySpec } from "../src/mapping/apply";
import { fixture } from "./helpers";

const TZ = "Europe/Madrid";
const spec = (key: string) => builtinSpecs.find((s) => s.key === key)!;
const detect = (path: string, text: string) => detectFile({ path, text, bytes: text.length });

describe("Google Fit CSV", () => {
  const text = fixture("google-fit-daily.csv");
  const detection = detect("Daily activity metrics.csv", text);

  it("sniffs the format, fields and records", () => {
    expect(detection.format).toBe("csv");
    expect(detection.fields).toContain("Step count");
    expect(detection.recordCount).toBe(6);
  });

  it("has a fingerprint that depends on shape, not filename", () => {
    expect(detect("x.csv", text).fingerprint).toBe(detection.fingerprint);
  });

  it("is matched by its built-in", () => {
    expect(scoreSpec(spec("google-fit.daily-activity"), detection, "Daily activity metrics.csv")).toBeGreaterThan(5);
  });

  it("converts rows into events", () => {
    const { events } = applySpec(text, spec("google-fit.daily-activity"), { timezone: TZ });
    const steps = events.filter((e) => e.typeKey === "steps");
    expect(steps).toHaveLength(5); // one empty row skipped
    expect(steps[0].value).toBe(8231);
    expect(steps[0].localDate).toBe("2024-03-01");
    expect(events.find((e) => e.typeKey === "distance")?.value).toBe(5.12); // metres → km
    expect(events.some((e) => e.localDate === "2024-03-05" && e.typeKey === "steps")).toBe(false);
  });
});

describe("Apple Health XML", () => {
  const text = fixture("apple-health.xml");
  const detection = detect("export.xml", text);
  const health = spec("apple-health.records");

  it("finds the repeated record element", () => {
    expect(detection.format).toBe("xml");
    expect(detection.reader).toMatchObject({ format: "xml", recordsPath: "HealthData.Record" });
    expect(scoreSpec(health, detection, "export.xml")).toBeGreaterThan(5);
  });

  it("routes records by type and derives sleep duration", () => {
    const { events } = applySpec(text, health, { timezone: TZ });
    expect(events.filter((e) => e.typeKey === "steps")).toHaveLength(3);
    expect(events.some((e) => e.typeKey === "body_mass" && e.value === 71.4)).toBe(true);
    const sleep = events.find((e) => e.typeKey === "sleep_duration");
    expect(sleep?.durationS).toBe(7 * 3600 + 12 * 60);
    expect(sleep?.localDate).toBe("2024-03-01"); // dated by when it started
  });
});

describe("unknown formats", () => {
  it("are not claimed by any built-in, so they go to the model", () => {
    const detection = detect("mood.csv", fixture("unknown-mood.csv"));
    expect(detection.reader).toMatchObject({ format: "csv", delimiter: ";" });
    expect(builtinSpecs.every((s) => scoreSpec(s, detection, "mood.csv") === 0)).toBe(true);
  });
});

/**
 * Samsung Health is where the awkward cases live: a preamble above the header,
 * dotted column names, a trailing comma on every row, and UTC timestamps whose
 * local day comes from a separate offset column.
 */
describe("Samsung Health export", () => {
  const sleepName = "com.samsung.shealth.sleep.20260923104408.csv";
  const sleepText = fixture("samsung-sleep.csv");
  const sleepDetection = detect(sleepName, sleepText);
  const sleepSpec = spec("samsung-health.sleep");

  it("reads the awkward CSV shape", () => {
    expect(sleepDetection.reader).toMatchObject({ format: "csv", skipLines: 1 });
    expect(sleepDetection.fields).toContain("com.samsung.health.sleep.start_time");
    expect(sleepDetection.fields).not.toContain("__parsed_extra");
    expect(sleepDetection.recordCount).toBe(3);
  });

  it("is matched only by the sleep built-in", () => {
    expect(scoreSpec(sleepSpec, sleepDetection, sleepName)).toBeGreaterThan(5);
    const others = builtinSpecs.filter((s) => s.key !== "samsung-health.sleep");
    expect(others.every((s) => scoreSpec(s, sleepDetection, sleepName) === 0)).toBe(true);
  });

  it("dates each night by the record's own offset, credited to the day you woke", () => {
    const durations = applySpec(sleepText, sleepSpec, { timezone: TZ }).events.filter((e) => e.typeKey === "sleep_duration");
    expect(durations).toHaveLength(3);
    const byId = new Map(durations.map((e) => [e.dedupeKey.split(":").pop(), e]));
    expect(byId.get("sleep-au-1")?.value).toBe(570); // derived when the column is blank
    expect(byId.get("sleep-eu-1")?.startedAt.toISOString()).toBe("2024-01-17T23:46:00.000Z");
    expect(byId.get("sleep-eu-1")?.localDate).toBe("2024-01-18");
    expect(byId.get("sleep-eu-2")?.localDate).toBe("2024-07-05");
    expect(byId.get("sleep-au-1")?.localDate).toBe("2024-08-07"); // Madrid would say the 6th
  });

  it("converts the daily activity summary", () => {
    const name = "com.samsung.shealth.activity.day_summary.20260923104408.csv";
    const text = fixture("samsung-activity-day.csv");
    const daySpec = spec("samsung-health.activity-day-summary");
    expect(scoreSpec(daySpec, detect(name, text), name)).toBeGreaterThan(5);

    const { events } = applySpec(text, daySpec, { timezone: TZ });
    const value = (type: string) => events.find((e) => e.typeKey === type)?.value;
    expect(value("steps")).toBe(9965);
    expect(value("distance")).toBe(7.48);
    expect(value("active_minutes")).toBe(106);
    expect(events.every((e) => e.localDate === "2024-01-18")).toBe(true); // empty day adds nothing
  });

  it("skips redundant tables by name, and only those", () => {
    expect(ignoreReasonFor("com.samsung.shealth.step_daily_trend.20260923104408.csv")).not.toBeNull();
    expect(ignoreReasonFor("com.samsung.shealth.tracker.pedometer_day_summary.20260923104408.csv")).not.toBeNull();
    expect(ignoreReasonFor("com.samsung.shealth.activity.day_summary.20260923104408.csv")).toBeNull();
    expect(ignoreReasonFor("activities.csv")).toBeNull();
    expect(ignoreReasonFor("export.xml")).toBeNull();
  });
});
