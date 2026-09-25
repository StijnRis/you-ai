import { Pressable, Text, View } from "react-native";
import { Link, Stack } from "expo-router";
import { getMetricOverview } from "@youai/core/db/queries";
import { eachLocalDate } from "@youai/core/events/time";
import { durationOf, phaseOf } from "@youai/core/experiments/analyze";
import { awaitsEvaluation, listCheckins, listExperiments, todayFor } from "@youai/core/experiments/store";
import { getSetting } from "@youai/core/settings";
import { formatDate } from "@youai/core/format";
import { Badge, Button, Card, Loading, SectionHeading } from "@youai/ui";
import { Screen } from "../../components/screen";
import { CheckinToday, DesignChat, PhaseBadge, VerdictHeadline } from "../../components/experiment";
import { useQuery } from "../../lib/use-query";

async function loadExperiments() {
  const today = todayFor(await getSetting("timezone"));
  const [rows, metrics] = await Promise.all([listExperiments(), getMetricOverview()]);
  const items = await Promise.all(
    rows.map(async (row) => {
      const phase = phaseOf(row, today);
      const checkins = phase === "running" ? await listCheckins(row.id) : [];
      return {
        row,
        phase,
        daysIn: phase === "running" ? eachLocalDate(row.startDate, today).length : 0,
        todayDone: checkins.find((c) => c.localDate === today)?.done ?? null,
        doneCount: checkins.filter((c) => c.done).length,
        needsEvaluation: awaitsEvaluation(row, today),
      };
    }),
  );
  return { items, metrics: metrics.map((m) => ({ key: m.key, label: m.label, days: m.days })) };
}

export default function ExperimentsScreen() {
  const { data, loading } = useQuery(loadExperiments);
  if (loading && !data) return <Loading />;
  if (!data) return null;
  const { items, metrics } = data;
  const waiting = items.filter((item) => item.needsEvaluation);

  return (
    <Screen>
      <Stack.Screen options={{ title: "Experiments" }} />
      <SectionHeading
        title="Experiments"
        description="Change one thing for a set number of days, then see what it did. Each experiment is measured against the same number of days right before it started."
      />

      {waiting.length > 0 ? (
        <Card className="gap-3 border-accent bg-accent-soft">
          <Text className="text-sm font-medium text-text">
            {waiting.length === 1
              ? "One experiment has finished and is waiting for you."
              : `${waiting.length} experiments have finished and are waiting for you.`}
          </Text>
          <Text className="text-sm text-muted">The data for the whole window is in. Open one to get the verdict on whether it helped.</Text>
          <View className="flex-row flex-wrap gap-2">
            {waiting.map((item) => (
              <Link key={item.row.id} href={`/experiments/${item.row.id}`} asChild>
                <Button>{`Evaluate “${item.row.title}”`}</Button>
              </Link>
            ))}
          </View>
        </Card>
      ) : null}

      <DesignChat metrics={metrics} hasExperiments={items.length > 0} />

      <View>
        <Text className="mb-3 text-sm font-medium text-text">
          {items.length === 0 ? "Your experiments" : `Your experiments (${items.length})`}
        </Text>
        {items.length === 0 ? (
          <Card>
            <Text className="py-6 text-center text-sm text-muted">
              Nothing yet. Describe what you want to improve above and the AI will design the first one from the data you already have.
            </Text>
          </Card>
        ) : (
          <View className="gap-2">
            {items.map(({ row, phase, daysIn, todayDone, doneCount, needsEvaluation }) => (
              <Card key={row.id} className="gap-3">
                <Link href={`/experiments/${row.id}`} asChild>
                  <Pressable className="gap-1">
                    <View className="flex-row flex-wrap items-center gap-2">
                      {row.evaluation ? <VerdictHeadline verdict={row.evaluation.verdict} /> : null}
                      {needsEvaluation ? <Badge tone="accent">ready to evaluate</Badge> : null}
                      <PhaseBadge phase={phase} />
                    </View>
                    <Text className="font-medium text-text">{row.title}</Text>
                    <Text className="text-sm text-muted">{row.intervention}</Text>
                    <Text className="text-xs text-subtle">
                      {formatDate(row.startDate)} – {formatDate(row.endDate)} · {durationOf(row)} days
                      {phase === "running" ? ` · day ${daysIn} · done ${doneCount}×` : ""}
                      {row.targetMetrics.length ? ` · measuring ${row.targetMetrics.join(", ")}` : ""}
                    </Text>
                    {row.evaluation ? <Text className="text-sm text-text">{row.evaluation.headline}</Text> : null}
                  </Pressable>
                </Link>
                {phase === "running" ? (
                  <View className="border-t border-border pt-3">
                    <CheckinToday experimentId={row.id} done={todayDone} />
                  </View>
                ) : null}
              </Card>
            ))}
          </View>
        )}
      </View>
    </Screen>
  );
}
