import { describe, expect, it } from "vitest";
import { compareWeekendVsWeekday, correlateAll, pValueFor, summarize } from "../src/stats/correlate";
import { localDateOf, shiftLocalDate } from "../src/events/time";

const dates = Array.from({ length: 60 }, (_, i) => shiftLocalDate("2024-01-01", i));

describe("timezones", () => {
  it("dates a late-night event by the local day", () => {
    // 00:30 Madrid on 2 March is 23:30 UTC on 1 March.
    const lateNight = new Date("2024-03-01T23:30:00Z");
    expect(localDateOf(lateNight, "Europe/Madrid")).toBe("2024-03-02");
    expect(localDateOf(lateNight, "UTC")).toBe("2024-03-01");
  });

  it("does date arithmetic across months and leap days", () => {
    expect(shiftLocalDate("2024-02-28", 2)).toBe("2024-03-01");
    expect(shiftLocalDate("2024-02-28", 1)).toBe("2024-02-29");
  });
});

describe("correlation engine", () => {
  const linearA = new Map(dates.map((d, i) => [d, i]));

  it("gives r = 1 for a perfectly linear pair, flagged significant", () => {
    const [result] = correlateAll(
      [
        { typeKey: "a", points: linearA },
        { typeKey: "b", points: new Map(dates.map((d, i) => [d, 3 * i + 10])) },
      ],
      { maxLag: 0, minOverlap: 10 },
    );
    expect(result.pearson).toBeCloseTo(1, 9);
    expect(result.significant).toBe(true);
  });

  it("finds a lagged relationship at the right shift", () => {
    const cause = new Map(dates.map((d, i) => [d, Math.sin(i / 3) * 100 + 500]));
    const effect = new Map(dates.map((d, i) => [d, (Math.sin((i - 1) / 3) * 100 + 500) * 0.8 + 20]));
    const results = correlateAll(
      [
        { typeKey: "cause", points: cause },
        { typeKey: "effect", points: effect },
      ],
      { maxLag: 2, minOverlap: 10 },
    );
    const best = results[0];
    expect(Math.abs(best.lag)).toBe(1);
    expect(Math.abs(results.find((r) => r.lag === 0)!.pearson)).toBeLessThan(Math.abs(best.pearson));
  });

  it("does not report noise after the multiple-comparison correction", () => {
    let seed = 42;
    const random = () => {
      seed = (seed * 1664525 + 1013904223) % 4294967296;
      return seed / 4294967296;
    };
    const noise = Array.from({ length: 8 }, (_, s) => ({
      typeKey: `noise${s}`,
      points: new Map(dates.map((d) => [d, random()])),
    }));
    expect(correlateAll(noise, { maxLag: 1, minOverlap: 20 }).filter((r) => r.significant)).toHaveLength(0);
  });

  it("computes sensible p-values", () => {
    expect(pValueFor(0, 30)).toBeCloseTo(1, 9);
    expect(pValueFor(0.4, 100)).toBeLessThan(pValueFor(0.4, 20));
  });

  it("detects a weekend/weekday difference with a large effect", () => {
    // Jittered: a constant group has zero variance and Cohen's d is undefined.
    const points = new Map(
      dates.map((d, i) => {
        const day = new Date(`${d}T00:00:00Z`).getUTCDay();
        return [d, (day === 0 || day === 6 ? 12000 : 6000) + ((i * 37) % 11) * 50];
      }),
    );
    const comparison = compareWeekendVsWeekday({ typeKey: "steps", points });
    expect(comparison.groups[1].mean).toBeGreaterThan(comparison.groups[0].mean);
    expect(comparison.effectSize ?? 0).toBeGreaterThan(2);
  });

  it("summarises a series with its true trend", () => {
    const summary = summarize({ typeKey: "a", points: linearA })!;
    expect(summary.trendPerDay).toBeCloseTo(1, 6);
    expect(summary.n).toBe(60);
  });
});
