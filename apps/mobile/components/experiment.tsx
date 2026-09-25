import { useState } from "react";
import { Alert, Platform, Pressable, Text, TextInput, View } from "react-native";
import { useRouter } from "expo-router";
import type { ExperimentEvaluation } from "@youai/db";
import type { ExperimentPhase, MetricOutcome } from "@youai/core/experiments/analyze";
import { changeExperiment, deleteExperiment, getExperimentReport, saveEvaluation, setCheckin, todayFor } from "@youai/core/experiments/store";
import { evaluateExperiment } from "@youai/core/experiments/evaluate";
import { getSetting } from "@youai/core/settings";
import { Badge, Button, Card, cn, ErrorText } from "@youai/ui";
import { ChatPanel } from "./chat-panel";
import { notifyDataChanged } from "../lib/data-events";

const PHASE = {
  scheduled: { label: "scheduled", tone: "neutral" },
  running: { label: "running", tone: "accent" },
  finished: { label: "finished", tone: "positive" },
  abandoned: { label: "abandoned", tone: "danger" },
} as const;

export function PhaseBadge({ phase }: { phase: ExperimentPhase }) {
  return <Badge tone={PHASE[phase].tone}>{PHASE[phase].label}</Badge>;
}

const OUTCOME = {
  improved: { label: "improved", tone: "positive" },
  worsened: { label: "worsened", tone: "negative" },
  changed: { label: "changed", tone: "accent" },
  no_clear_change: { label: "no clear change", tone: "neutral" },
  not_enough_data: { label: "not enough data", tone: "neutral" },
} as const;

export function VerdictBadge({ verdict }: { verdict: MetricOutcome["verdict"] }) {
  return <Badge tone={OUTCOME[verdict].tone}>{OUTCOME[verdict].label}</Badge>;
}

const VERDICT = {
  helped: { label: "It helped", tone: "positive" },
  worsened: { label: "It made things worse", tone: "negative" },
  no_change: { label: "No real change", tone: "neutral" },
  inconclusive: { label: "Not enough to say", tone: "neutral" },
} as const;

export function VerdictHeadline({ verdict }: { verdict: ExperimentEvaluation["verdict"] }) {
  return <Badge tone={VERDICT[verdict].tone}>{VERDICT[verdict].label}</Badge>;
}

/** "Sep 23" — short enough for one grid cell. */
export function shortDay(date: string): string {
  return new Date(`${date}T00:00:00Z`).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
}

async function checkin(experimentId: string, done: boolean, date?: string) {
  const today = todayFor(await getSetting("timezone"));
  const day = date ?? today;
  if (day > today) throw new Error("Cannot check in for a day that hasn't happened yet.");
  const outcome = await setCheckin(experimentId, day, done);
  if (outcome === "not_found") throw new Error("Experiment not found");
  if (outcome === "outside_window") throw new Error("That day is outside the experiment's dates.");
  notifyDataChanged();
}

/** Today's yes/no. The one interaction that has to be effortless, every day. */
export function CheckinToday({ experimentId, done }: { experimentId: string; done: boolean | null }) {
  const [error, setError] = useState<string | null>(null);
  const press = (value: boolean) =>
    checkin(experimentId, value).catch((cause: unknown) => setError(cause instanceof Error ? cause.message : String(cause)));
  return (
    <View className="flex-row flex-wrap items-center gap-2">
      <Text className="text-sm text-muted">Did you do it today?</Text>
      <Pressable onPress={() => void press(true)} className={cn("rounded-lg border px-3 py-1.5", done === true ? "border-positive" : "border-border")}>
        <Text className={cn("text-sm", done === true ? "text-positive" : "text-text")}>✓ Done</Text>
      </Pressable>
      <Pressable onPress={() => void press(false)} className={cn("rounded-lg border px-3 py-1.5", done === false ? "border-negative" : "border-border")}>
        <Text className={cn("text-sm", done === false ? "text-negative" : "text-text")}>✕ Skipped</Text>
      </Pressable>
      <ErrorText>{error}</ErrorText>
    </View>
  );
}

export type DayCell = { date: string; label: string; done: boolean | null; future: boolean };

/** One square per day. Tapping a past day toggles it, so a forgotten check-in can be filled in. */
export function CheckinGrid({ experimentId, days }: { experimentId: string; days: DayCell[] }) {
  return (
    <View className="flex-row flex-wrap gap-1.5">
      {days.map((day) => (
        <Pressable
          key={day.date}
          disabled={day.future}
          onPress={() => void checkin(experimentId, day.done !== true, day.date).catch(() => undefined)}
          className={cn(
            "size-10 items-center justify-center rounded-lg border",
            day.future ? "border-dashed border-border" : day.done === true ? "border-positive" : day.done === false ? "border-negative" : "border-border",
          )}
        >
          <Text className={cn("text-[10px] font-medium", day.done === true ? "text-positive" : day.done === false ? "text-negative" : "text-muted")}>
            {day.label.split(" ")[1]}
          </Text>
          <Text className="text-[10px] text-subtle">{day.label.split(" ")[0]}</Text>
        </Pressable>
      ))}
    </View>
  );
}

function confirmDelete(): Promise<boolean> {
  if (Platform.OS === "web") return Promise.resolve(globalThis.confirm?.("Delete this experiment and its check-ins?") ?? false);
  return new Promise((resolve) =>
    Alert.alert("Delete experiment?", "Its check-ins are deleted too.", [
      { text: "Cancel", style: "cancel", onPress: () => resolve(false) },
      { text: "Delete", style: "destructive", onPress: () => resolve(true) },
    ]),
  );
}

export function ExperimentActions({ experimentId, phase, conclusion }: { experimentId: string; phase: ExperimentPhase; conclusion: string | null }) {
  const router = useRouter();
  const [draft, setDraft] = useState(conclusion ?? "");
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function run(key: string, action: () => Promise<void>) {
    setBusy(key);
    setError(null);
    try {
      await action();
      notifyDataChanged();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(null);
    }
  }

  const change = (action: "end_now" | "abandon" | "conclude") =>
    run(action, async () => {
      await changeExperiment({ timezone: await getSetting("timezone") }, experimentId, action, draft);
    });

  return (
    <View className="gap-4">
      {phase === "finished" || phase === "abandoned" ? (
        <View className="gap-2">
          <Text className="text-sm font-medium text-text">Your conclusion</Text>
          <TextInput
            value={draft}
            onChangeText={setDraft}
            multiline
            placeholder="What did you learn? Will you keep doing it?"
            placeholderTextColor="#a8a29e"
            className="min-h-20 rounded-lg border border-border bg-surface px-3 py-2 text-sm text-text"
          />
          <Button className="self-start" onPress={() => void change("conclude")} busy={busy === "conclude"} disabled={draft === (conclusion ?? "")}>
            Save conclusion
          </Button>
        </View>
      ) : null}
      <View className="flex-row flex-wrap gap-2">
        {phase === "running" ? (
          <Button variant="secondary" busy={busy === "end_now"} onPress={() => void change("end_now")}>End today</Button>
        ) : null}
        {phase === "running" || phase === "scheduled" ? (
          <Button variant="secondary" busy={busy === "abandon"} onPress={() => void change("abandon")}>Abandon</Button>
        ) : null}
        <Button
          variant="danger"
          busy={busy === "delete"}
          onPress={() =>
            void run("delete", async () => {
              if (!(await confirmDelete())) return;
              await deleteExperiment(experimentId);
              router.back();
            })
          }
        >
          Delete
        </Button>
      </View>
      <ErrorText>{error}</ErrorText>
    </View>
  );
}

/**
 * The payoff: one button that reads the finished experiment and says whether it
 * worked. The statistics are already above; this adds the judgement.
 */
export function EvaluatePanel({
  experimentId,
  phase,
  evaluation,
  metricLabels,
}: {
  experimentId: string;
  phase: ExperimentPhase;
  evaluation: ExperimentEvaluation | null;
  metricLabels: Record<string, string>;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<ExperimentEvaluation | null>(evaluation);

  if (phase !== "finished" && phase !== "abandoned") {
    return (
      <Card>
        <Text className="font-medium text-text">Did it help?</Text>
        <Text className="mt-1 text-sm text-muted">
          {phase === "scheduled"
            ? "You will be able to evaluate this once it has run."
            : "Still running — the verdict unlocks when it finishes, so it is read on the full window rather than half of one."}
        </Text>
      </Card>
    );
  }

  async function evaluate() {
    setBusy(true);
    setError(null);
    try {
      const report = await getExperimentReport(experimentId, await getSetting("timezone"));
      if (!report) throw new Error("Experiment not found");
      const next = await evaluateExperiment(report);
      await saveEvaluation(experimentId, next);
      setResult(next);
      notifyDataChanged();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card className="gap-4">
      <View>
        <Text className="font-medium text-text">Did it help?</Text>
        <Text className="mt-0.5 text-sm text-muted">
          The AI reads the numbers above — the change, the p-value and how often you did it — and gives you a straight answer.
        </Text>
      </View>
      <Button className="self-start" busy={busy} onPress={() => void evaluate()}>
        {busy ? "Reading the data…" : result ? "Re-evaluate" : "✨ Evaluate"}
      </Button>
      <ErrorText>{error}</ErrorText>
      {result ? (
        <View className="gap-4 border-t border-border pt-4">
          <View className="flex-row flex-wrap items-center gap-2">
            <VerdictHeadline verdict={result.verdict} />
            <Text className="flex-1 text-sm font-medium text-text">{result.headline}</Text>
          </View>
          <Text className="text-sm leading-relaxed text-muted">{result.detail}</Text>
          {result.perMetric.map((entry) => (
            <View key={entry.metric}>
              <Text className="text-sm font-medium text-text">{metricLabels[entry.metric] ?? entry.metric}</Text>
              <Text className="text-sm text-muted">{entry.note}</Text>
            </View>
          ))}
          <View>
            <Text className="text-xs font-medium uppercase tracking-wide text-subtle">What to do now</Text>
            <Text className="mt-1 text-sm leading-relaxed text-text">{result.recommendation}</Text>
          </View>
          {result.caveat ? <Text className="rounded-lg bg-surface-2 px-3 py-2 text-xs leading-relaxed text-muted">{result.caveat}</Text> : null}
        </View>
      ) : null}
    </Card>
  );
}

type MetricInfo = { key: string; label: string; days: number };

/** Openers phrased around what this person actually tracks, best-covered first. */
function openersFor(metrics: MetricInfo[]): string[] {
  const names = [...metrics].sort((a, b) => b.days - a.days).slice(0, 3).map((m) => m.label.toLowerCase());
  const openers = ["Look at my data and suggest an experiment worth running."];
  if (names[0]) openers.push(`What could I change to improve my ${names[0]}?`);
  if (names[1]) openers.push(`Design a one-week experiment to improve my ${names[1]}.`);
  openers.push("I want to sleep better — find some evidence and set up an experiment.");
  openers.push("Would cold showers do anything for me? Set it up for a week.");
  return openers;
}

export function DesignChat({ metrics, hasExperiments }: { metrics: MetricInfo[]; hasExperiments: boolean }) {
  // Open for a first-time user; collapsed once there is a list to look at.
  const [open, setOpen] = useState(!hasExperiments);
  return (
    <View className="rounded-xl border border-border">
      <Pressable onPress={() => setOpen(!open)} className="flex-row items-center gap-3 px-4 py-3">
        <View className="size-8 items-center justify-center rounded-lg bg-accent-soft">
          <Text>🧪</Text>
        </View>
        <View className="flex-1">
          <Text className="text-sm font-medium text-text">Design an experiment with the AI</Text>
          <Text className="text-sm text-muted">
            {metrics.length === 0
              ? "Import some data first — an experiment is judged on metrics you already track."
              : `Talk through what you want to improve. It reads your ${metrics.length} metrics, looks up the evidence, and sets the experiment up for you.`}
          </Text>
        </View>
        <Text className="text-muted">{open ? "▴" : "▾"}</Text>
      </Pressable>
      {open ? (
        <View className="border-t border-border p-4">
          <ChatPanel metrics={metrics} suggestions={openersFor(metrics)} emptyHint="Tell it what you want to improve, or start from one of these:" />
        </View>
      ) : null}
    </View>
  );
}
