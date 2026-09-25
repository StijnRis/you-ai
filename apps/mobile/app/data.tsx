import { Text, View } from "react-native";
import { Link, Stack } from "expo-router";
import { getDailySeries, getDataRange, getEventCounts, getMetricOverview, listSources } from "@youai/core/db/queries";
import { getSetting } from "@youai/core/settings";
import { formatDate, formatNumber } from "@youai/core/format";
import { Button, Card, EmptyState, Loading, MetricSparkline, SectionHeading, Stat } from "@youai/ui";
import { Screen } from "../components/screen";
import { useQuery } from "../lib/use-query";

async function loadData() {
  const [metrics, range, counts, sourceRows, series, timezone] = await Promise.all([
    getMetricOverview(),
    getDataRange(),
    getEventCounts(),
    listSources(),
    getDailySeries(),
    getSetting("timezone"),
  ]);
  const sourceLabel = new Map(sourceRows.map((row) => [row.id, row.label]));

  // Records and contributing sources per metric.
  const perMetric = new Map<string, { records: number; sources: Set<string> }>();
  for (const row of counts) {
    const entry = perMetric.get(row.typeKey) ?? { records: 0, sources: new Set<string>() };
    entry.records += row.events;
    entry.sources.add(row.sourceId ? (sourceLabel.get(row.sourceId) ?? "Removed source") : "Manual");
    perMetric.set(row.typeKey, entry);
  }

  const byCategory = new Map<string, typeof metrics>();
  for (const metric of metrics) {
    const category = metric.category ?? "other";
    byCategory.set(category, [...(byCategory.get(category) ?? []), metric]);
  }

  return {
    metrics,
    range,
    timezone,
    perMetric,
    byCategory,
    sourceCount: sourceRows.length,
    totalRecords: counts.reduce((sum, row) => sum + row.events, 0),
    seriesByKey: new Map(series.map((one) => [one.typeKey, one])),
  };
}

export default function DataScreen() {
  const { data, loading } = useQuery(loadData);
  if (loading && !data) return <Loading />;

  return (
    <Screen>
      <Stack.Screen options={{ title: "Data" }} />
      {!data || data.metrics.length === 0 ? (
        <>
          <SectionHeading title="Your data" description="Everything stored on this device, per metric." />
          <EmptyState
            title="No data yet"
            description="Connect a source — or the sample data, to look around first — or import an export."
            action={
              <Link href="/sources" asChild>
                <Button>Go to Sources</Button>
              </Link>
            }
          />
        </>
      ) : (
        <>
          <View>
            <SectionHeading
              title="Your data"
              description={data.range ? `${formatDate(data.range.from)} to ${formatDate(data.range.to)}, in ${data.timezone}.` : undefined}
            />
            <View className="flex-row flex-wrap gap-3">
              <Card className="min-w-[140px] flex-1"><Stat label="Records" value={data.totalRecords.toLocaleString()} /></Card>
              <Card className="min-w-[140px] flex-1"><Stat label="Metrics" value={data.metrics.length} /></Card>
              <Card className="min-w-[140px] flex-1"><Stat label="Days covered" value={data.range?.days ?? 0} /></Card>
              <Card className="min-w-[140px] flex-1"><Stat label="Sources" value={data.sourceCount} /></Card>
            </View>
          </View>

          {[...data.byCategory.entries()].map(([category, group]) => (
            <View key={category}>
              <SectionHeading title={category.charAt(0).toUpperCase() + category.slice(1)} />
              <View className="gap-2">
                {group.map((metric) => {
                  const info = data.perMetric.get(metric.key);
                  const one = data.seriesByKey.get(metric.key);
                  return (
                    <Card key={metric.key}>
                      <View className="flex-row items-start justify-between gap-3">
                        <View className="flex-1">
                          <Text className="font-medium text-text">{metric.label}</Text>
                          <Text className="font-mono text-xs text-subtle">{metric.key}</Text>
                        </View>
                        <View className="items-end">
                          <Text className="text-sm font-medium text-text">{formatNumber(metric.latestValue, metric.unit)}</Text>
                          <Text className="text-xs text-muted">avg {formatNumber(metric.average, metric.unit)}</Text>
                        </View>
                      </View>
                      <Text className="mt-2 text-xs text-muted">
                        {info ? [...info.sources].join(", ") : "—"} · {(info?.records ?? 0).toLocaleString()} records · {metric.days} days
                        {metric.firstDate && metric.lastDate ? ` · ${formatDate(metric.firstDate)} – ${formatDate(metric.lastDate)}` : ""}
                      </Text>
                      {one ? <MetricSparkline series={[...one.points.entries()]} unit={metric.unit} /> : null}
                    </Card>
                  );
                })}
              </View>
            </View>
          ))}
        </>
      )}
    </Screen>
  );
}
