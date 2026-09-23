import { Badge } from "@/components/ui";
import type { ExperimentPhase, MetricOutcome } from "@/lib/experiments/analyze";

const PHASE = {
  scheduled: { label: "scheduled", tone: "neutral" },
  running: { label: "running", tone: "accent" },
  finished: { label: "finished", tone: "positive" },
  abandoned: { label: "abandoned", tone: "danger" },
} as const;

export function PhaseBadge({ phase }: { phase: ExperimentPhase }) {
  return <Badge tone={PHASE[phase].tone}>{PHASE[phase].label}</Badge>;
}

const VERDICT = {
  improved: { label: "improved", tone: "positive" },
  worsened: { label: "worsened", tone: "negative" },
  changed: { label: "changed", tone: "accent" },
  no_clear_change: { label: "no clear change", tone: "neutral" },
  not_enough_data: { label: "not enough data", tone: "neutral" },
} as const;

export function VerdictBadge({ verdict }: { verdict: MetricOutcome["verdict"] }) {
  return <Badge tone={VERDICT[verdict].tone}>{VERDICT[verdict].label}</Badge>;
}

/** "Sep 23" — short enough for one grid cell. */
export function shortDay(date: string): string {
  return new Date(`${date}T00:00:00Z`).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  });
}
