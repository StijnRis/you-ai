import { Text, View } from "react-native";
import { Link } from "expo-router";
import { getDailySeries, getDataRange, getMetricOverview } from "@youai/core/db/queries";
import { correlateAll, summarize } from "@youai/core/stats/correlate";
import { describeLag, formatDate, formatNumber } from "@youai/core/format";
import { Badge, Button, Card, EmptyState, Loading, MetricSparkline, SectionHeading, Stat } from "@youai/ui";
import { Screen } from "../../components/screen";
import { useQuery } from "../../lib/use-query";

async function loadDashboard() {
  const [metrics, range, series] = await Promise.all([getMetricOverview(), getDataRange(), getDailySeries()]);

  // One headline finding, so the dashboard says something rather than only
  // showing tiles. The full list lives on Insights.
  const correlatable = series.filter((one) => {
    const metric = metrics.find((m) => m.key === one.typeKey);
    return metric?.correlatable && metric.valueKind !== "categorical";
  });
  const topFindings = correlateAll(correlatable, { minOverlap: 14, maxLag: 2 }).slice(0, 3);
  return { metrics, range, seriesByKey: new Map(series.map((one) => [one.typeKey, one])), topFindings };
}

export default function DashboardScreen() {
  const { data, loading } = useQuery(loadDashboard);

  if (loading && !data) return <Loading />;
  if (!data || data.metrics.length === 0) {
    return (
      <Screen tab>
        <SectionHeading title="Dashboard" description="Nothing here yet — connect a source or import an export to get started." />
        <EmptyState
          title="No data yet"
          description="Import a data dump from a service you already use, or connect the weather adapter to get a baseline series to correlate everything else against."
          action={
            <View className="flex-row gap-3">
              <Link href="/import" asChild>
                <Button>Import a file</Button>
              </Link>
              <Link href="/sources" asChild>
                <Button variant="secondary">Connect a source</Button>
              </Link>
            </View>
          }
        />
      </Screen>
    );
  }

  const { metrics, range, seriesByKey, topFindings } = data;

  return (
    <Screen tab>
      <View>
        <SectionHeading
          title="Dashboard"
          description={range ? `${range.days} days of data, ${formatDate(range.from)} to ${formatDate(range.to)}.` : undefined}
        />
        <View className="gap-3 sm:flex-row sm:flex-wrap">
          {metrics.slice(0, 9).map((metric) => {
            const one = seriesByKey.get(metric.key);
            const summary = one ? summarize(one) : null;
            const change = summary?.recentChangePct;
            return (
              <Card key={metric.key} className="sm:w-[48%]">
                <View className="flex-row items-start justify-between gap-3">
                  <Stat
                    label={metric.label}
                    value={formatNumber(metric.latestValue, metric.unit)}
                    hint={summary ? `avg ${formatNumber(summary.mean, metric.unit)} over ${summary.n} days` : undefined}
                  />
                  {change !== null && change !== undefined ? (
                    <Badge
                      tone={
                        // Colour by whether the change is good for *this* metric,
                        // not by its sign — a falling resting heart rate is good.
                        metric.polarity === 0 ? "neutral" : change * metric.polarity > 0 ? "positive" : "negative"
                      }
                    >
                      {change > 0 ? "↑" : "↓"} {Math.abs(change).toFixed(0)}%
                    </Badge>
                  ) : null}
                </View>
                {one ? <MetricSparkline series={[...one.points.entries()]} unit={metric.unit} /> : null}
              </Card>
            );
          })}
        </View>
      </View>

      {topFindings.length > 0 ? (
        <View>
          <SectionHeading
            title="Strongest patterns"
            description="The relationships with the largest coefficients right now."
            action={
              <Link href="/insights">
                <Text className="text-sm font-medium text-accent">All insights →</Text>
              </Link>
            }
          />
          <View className="gap-3">
            {topFindings.map((finding) => {
              const a = metrics.find((m) => m.key === finding.a);
              const b = metrics.find((m) => m.key === finding.b);
              return (
                <Card key={`${finding.a}-${finding.b}-${finding.lag}`} className="flex-row items-center justify-between gap-3">
                  <Text className="flex-1 text-sm text-text">
                    <Text className="font-medium">{a?.label ?? finding.a}</Text>
                    <Text className="text-muted"> and </Text>
                    <Text className="font-medium">{b?.label ?? finding.b}</Text>
                    <Text className="text-muted">
                      {" "}move {finding.pearson > 0 ? "together" : "in opposite directions"} ({describeLag(finding.lag)}, n={finding.n})
                    </Text>
                  </Text>
                  <Text className={finding.pearson > 0 ? "text-sm font-semibold text-positive" : "text-sm font-semibold text-negative"}>
                    r = {finding.pearson.toFixed(2)}
                  </Text>
                </Card>
              );
            })}
          </View>
        </View>
      ) : null}
    </Screen>
  );
}
