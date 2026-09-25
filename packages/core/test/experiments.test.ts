import { describe, expect, it } from "vitest";
import { analyzeExperiment, phaseOf, windowsFor } from "../src/experiments/analyze";
import { awaitsEvaluation } from "../src/experiments/store";
import { briefFor } from "../src/experiments/evaluate";
import { eachLocalDate, shiftLocalDate } from "../src/events/time";

describe("experiment windows and phases", () => {
  const experiment = { startDate: "2024-03-08", endDate: "2024-03-14", status: "active" as const };

  it("compares against an equally long baseline just before, and mirrors it after", () => {
    const windows = windowsFor(experiment, "2024-03-30");
    expect(windows.baseline).toMatchObject({ from: "2024-03-01", to: "2024-03-07" });
    expect(windows.after).toMatchObject({ from: "2024-03-15", to: "2024-03-21" });
    expect(windowsFor(experiment, "2024-03-10").during?.to).toBe("2024-03-10");
  });

  it("derives the phase from the dates, except when abandoned", () => {
    expect(phaseOf(experiment, "2024-03-01")).toBe("scheduled");
    expect(phaseOf(experiment, "2024-03-08")).toBe("running");
    expect(phaseOf(experiment, "2024-03-15")).toBe("finished");
    expect(phaseOf({ ...experiment, status: "abandoned" }, "2024-03-10")).toBe("abandoned");
  });

  it("calls a real shift an improvement and noise no change", () => {
    const mood = new Map<string, number>();
    const steps = new Map<string, number>();
    for (let i = 0; i < 21; i++) {
      const date = shiftLocalDate("2024-03-01", i);
      const during = date >= experiment.startDate && date <= experiment.endDate;
      mood.set(date, (during ? 7 : 5) + ((i * 7) % 3) * 0.2);
      steps.set(date, 8000 + ((i * 13) % 5) * 300);
    }
    const report = analyzeExperiment({
      experiment,
      today: "2024-03-30",
      series: [
        { typeKey: "mood", points: mood },
        { typeKey: "steps", points: steps },
      ],
      meta: new Map([
        ["mood", { label: "Mood", unit: null, polarity: 1 }],
        ["steps", { label: "Steps", unit: "steps", polarity: 1 }],
      ]),
      targetMetrics: ["mood", "steps", "untracked"],
      doneDates: new Set(["2024-03-08", "2024-03-09", "2024-03-10", "2024-03-11", "2024-03-12"]),
    });
    const [moodOutcome, stepsOutcome, missing] = report.outcomes;
    expect(moodOutcome.verdict).toBe("improved");
    expect(stepsOutcome.verdict).toBe("no_clear_change");
    expect(missing.verdict).toBe("not_enough_data");
    expect(report.adherence).toMatchObject({ daysDone: 5, daysElapsed: 7 });
  });
});

describe("experiment evaluation", () => {
  const base = {
    id: "e1",
    title: "Cold shower",
    intervention: "Two minutes of cold water at the end of the morning shower",
    hypothesis: "Deep sleep goes up",
    rationale: null,
    sources: [],
    targetMetrics: ["sleep_deep"],
    startDate: "2024-03-01",
    endDate: "2024-03-07",
    status: "active" as const,
    conclusion: null,
    evaluation: null,
    evaluatedAt: null,
    createdBy: "ai" as const,
    createdAt: new Date(),
  };

  it("counts only finished, unevaluated, non-abandoned experiments", () => {
    expect(awaitsEvaluation(base, "2024-03-08")).toBe(true);
    expect(awaitsEvaluation(base, "2024-03-05")).toBe(false);
    expect(awaitsEvaluation(base, "2024-03-07")).toBe(false); // today's data is still to come
    const evaluation = { verdict: "helped" as const, headline: "h", detail: "d", perMetric: [], recommendation: "r", caveat: null };
    expect(awaitsEvaluation({ ...base, evaluation }, "2024-03-08")).toBe(false);
    expect(awaitsEvaluation({ ...base, status: "abandoned" }, "2024-03-08")).toBe(false);
  });

  it("hands the model finished statistics, not raw days", () => {
    const baselineDays = [37, 41, 39, 43, 38, 42, 40];
    const duringDays = [46, 50, 47, 51, 45, 49, 48];
    const series = [
      {
        typeKey: "sleep_deep",
        points: new Map<string, number>([
          ...eachLocalDate("2024-02-23", "2024-02-29").map((d, i) => [d, baselineDays[i]] as [string, number]),
          ...eachLocalDate("2024-03-01", "2024-03-07").map((d, i) => [d, duringDays[i]] as [string, number]),
        ]),
      },
    ];
    const reportFor = (doneDates: Set<string>) =>
      analyzeExperiment({
        experiment: base,
        today: "2024-03-08",
        series,
        meta: new Map([["sleep_deep", { label: "Deep sleep", unit: "min", polarity: 1 }]]),
        targetMetrics: ["sleep_deep"],
        doneDates,
      });

    const brief = briefFor({ experiment: base, phase: "finished", today: "2024-03-08", checkins: [], report: reportFor(new Set(eachLocalDate("2024-03-01", "2024-03-07"))) });
    expect(brief.hypothesis).toBe("Deep sleep goes up");
    expect(brief.metrics[0]).toMatchObject({ changePct: 20, baselineMean: 40, duringMean: 48, statisticalVerdict: "improved" });
    expect(brief.adherence.ratePct).toBe(100);

    const noCheckins = briefFor({ experiment: base, phase: "finished", today: "2024-03-08", checkins: [], report: reportFor(new Set()) });
    expect(noCheckins.adherence.note).not.toBeNull();
  });
});
