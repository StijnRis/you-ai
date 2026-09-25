import type { ReactNode } from "react";
import { Linking, Pressable, Text, View } from "react-native";
import { Link, Stack, useLocalSearchParams } from "expo-router";
import { eachLocalDate } from "@youai/core/events/time";
import { durationOf, type WindowStats } from "@youai/core/experiments/analyze";
import { getExperimentReport } from "@youai/core/experiments/store";
import { getSetting } from "@youai/core/settings";
import { formatDate, formatNumber, formatP } from "@youai/core/format";
import { Button, Card, EmptyState, Loading, SectionHeading } from "@youai/ui";
import { Screen } from "../../components/screen";
import { CheckinGrid, CheckinToday, EvaluatePanel, ExperimentActions, PhaseBadge, shortDay, VerdictBadge } from "../../components/experiment";
import { useQuery } from "../../lib/use-query";

export default function ExperimentScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { data: result, loading } = useQuery(async () => getExperimentReport(id, await getSetting("timezone")), [id]);

  if (loading && !result) return <Loading />;
  if (!result) {
    return (
      <Screen>
        <EmptyState title="Experiment not found" description="It may have been deleted." />
      </Screen>
    );
  }

  const { experiment, phase, today, checkins, report } = result;
  const byDate = new Map(checkins.map((c) => [c.localDate, c.done]));
  const days = eachLocalDate(experiment.startDate, experiment.endDate).map((date) => ({
    date,
    label: shortDay(date),
    done: byDate.get(date) ?? null,
    future: date > today,
  }));
  const askPrompt = `How did my experiment "${experiment.title}" go? What does the data say?`;

  return (
    <Screen>
      <Stack.Screen options={{ title: experiment.title }} />
      <SectionHeading
        title={experiment.title}
        description={`${formatDate(experiment.startDate)} – ${formatDate(experiment.endDate)} · ${durationOf(experiment)} days`}
        action={<PhaseBadge phase={phase} />}
      />

      <Card className="gap-4">
        <Field label="What to do each day">{experiment.intervention}</Field>
        <Field label="Hypothesis">{experiment.hypothesis}</Field>
        {experiment.rationale ? <Field label="Why">{experiment.rationale}</Field> : null}
        {experiment.sources.length > 0 ? (
          <View>
            <Label>Sources</Label>
            {experiment.sources.map((source) => (
              <Pressable key={source.url} onPress={() => void Linking.openURL(source.url)}>
                <Text className="mt-1 text-sm text-accent">{source.title} ↗</Text>
              </Pressable>
            ))}
          </View>
        ) : null}
      </Card>

      <Card className="gap-4">
        <View className="flex-row flex-wrap items-center justify-between gap-3">
          <Text className="font-medium text-text">Check-ins</Text>
          <Text className="text-xs text-muted">
            {report.adherence.daysElapsed > 0
              ? `Done on ${report.adherence.daysDone} of ${report.adherence.daysElapsed} days so far`
              : `Starts ${formatDate(experiment.startDate)}`}
          </Text>
        </View>
        {phase === "running" ? <CheckinToday experimentId={experiment.id} done={byDate.get(today) ?? null} /> : null}
        <CheckinGrid experimentId={experiment.id} days={days} />
        <Text className="text-xs text-subtle">Tap a past day to fill in or correct it.</Text>
      </Card>

      <Card className="gap-4">
        <View className="gap-2">
          <Text className="font-medium text-text">Results</Text>
          <Text className="text-xs text-muted">
            Baseline {formatDate(report.windows.baseline.from)} – {formatDate(report.windows.baseline.to)}
            {report.windows.during ? ` · during ${formatDate(report.windows.during.from)} – ${formatDate(report.windows.during.to)}` : ""}
            {report.windows.after ? ` · after ${formatDate(report.windows.after.from)} – ${formatDate(report.windows.after.to)}` : ""}
          </Text>
          <Link href={{ pathname: "/chat", params: { q: askPrompt } }} asChild>
            <Button variant="secondary" className="self-start">Ask the AI about it</Button>
          </Link>
        </View>

        {report.outcomes.length === 0 ? (
          <Text className="text-sm text-muted">This experiment has no metrics to measure.</Text>
        ) : (
          report.outcomes.map((outcome) => (
            <View key={outcome.metric} className="gap-2 border-t border-border pt-3">
              <View className="flex-row items-start justify-between gap-2">
                <View className="flex-1">
                  <Text className="font-medium text-text">{outcome.label}</Text>
                  <Text className="font-mono text-xs text-subtle">{outcome.metric}</Text>
                </View>
                <VerdictBadge verdict={outcome.verdict} />
              </View>
              <View className="flex-row flex-wrap gap-4">
                <WindowCell title="Before" stats={outcome.baseline} unit={outcome.unit} />
                <WindowCell
                  title="During"
                  stats={outcome.during}
                  unit={outcome.unit}
                  extra={outcome.duringOnProtocol && outcome.duringOnProtocol.n > 0 ? `${formatNumber(outcome.duringOnProtocol.mean, outcome.unit)} on days done` : undefined}
                />
                <View>
                  <Label>Change</Label>
                  <Text className="text-sm text-text">{formatPct(outcome.changePct)}</Text>
                  {outcome.pValue !== null ? (
                    <Text className="text-xs text-subtle">
                      {formatP(outcome.pValue)}
                      {outcome.effectSize !== null ? ` · d = ${outcome.effectSize.toFixed(2)}` : ""}
                    </Text>
                  ) : null}
                </View>
                {outcome.after.n > 0 ? (
                  <WindowCell
                    title="After"
                    stats={outcome.after}
                    unit={outcome.unit}
                    extra={outcome.afterChangePct !== null ? `${formatPct(outcome.afterChangePct)} vs before` : undefined}
                  />
                ) : null}
              </View>
            </View>
          ))
        )}
        <Text className="text-xs text-subtle">
          Averages per day, compared with a Welch t-test. This is a before/after comparison with no control group, so anything
          else that changed in the same days can explain a difference — and a short experiment can miss a real but small effect.
        </Text>
      </Card>

      <EvaluatePanel
        experimentId={experiment.id}
        phase={phase}
        evaluation={experiment.evaluation}
        metricLabels={Object.fromEntries(report.outcomes.map((o) => [o.metric, o.label]))}
      />

      <Card>
        <ExperimentActions experimentId={experiment.id} phase={phase} conclusion={experiment.conclusion} />
      </Card>
    </Screen>
  );
}

function Label({ children }: { children: ReactNode }) {
  return <Text className="text-xs font-medium uppercase tracking-wide text-subtle">{children}</Text>;
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <View>
      <Label>{label}</Label>
      <Text className="mt-1 text-sm leading-relaxed text-text">{children}</Text>
    </View>
  );
}

function WindowCell({ title, stats, unit, extra }: { title: string; stats: WindowStats; unit: string | null; extra?: string }) {
  return (
    <View>
      <Label>{title}</Label>
      {stats.n === 0 ? (
        <Text className="text-sm text-subtle">—</Text>
      ) : (
        <>
          <Text className="text-sm text-text">{formatNumber(stats.mean, unit)}</Text>
          <Text className="text-xs text-subtle">
            {stats.n} {stats.n === 1 ? "day" : "days"}
          </Text>
        </>
      )}
      {extra ? <Text className="text-xs text-subtle">{extra}</Text> : null}
    </View>
  );
}

function formatPct(value: number | null): string {
  if (value === null) return "—";
  return `${value > 0 ? "+" : ""}${value.toFixed(1)}%`;
}
