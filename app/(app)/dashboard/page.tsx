import Link from "next/link";
import { requireUser } from "@/lib/auth";
import { getDailySeries, getDataRange, getMetricOverview } from "@/lib/db/queries";
import { correlateAll, summarize } from "@/lib/stats/correlate";
import { Card, EmptyState, SectionHeading, Stat, Badge } from "@/components/ui";
import { MetricSparkline } from "@/components/charts";
import { formatDate, formatNumber, describeLag } from "@/lib/utils";

export default async function DashboardPage() {
  const user = await requireUser();
  const [metrics, range] = await Promise.all([
    getMetricOverview(user.id),
    getDataRange(user.id),
  ]);

  if (metrics.length === 0) {
    return (
      <>
        <SectionHeading
          title="Dashboard"
          description="Nothing here yet — connect a source or import an export to get started."
        />
        <EmptyState
          title="No data yet"
          description="Import a data dump from a service you already use, or connect the weather adapter to get a baseline series to correlate everything else against."
          action={
            <div className="flex justify-center gap-3">
              <Link
                href="/import"
                className="rounded-lg bg-text px-4 py-2 text-sm font-medium text-bg hover:opacity-90"
              >
                Import a file
              </Link>
              <Link
                href="/sources"
                className="rounded-lg border border-border px-4 py-2 text-sm font-medium hover:bg-surface-2"
              >
                Connect weather
              </Link>
            </div>
          }
        />
      </>
    );
  }

  const series = await getDailySeries(user.id);
  const seriesByKey = new Map(series.map((one) => [one.typeKey, one]));

  // One headline finding, so the dashboard says something rather than only
  // showing tiles. The full list lives on Insights.
  const correlatable = series.filter((one) => {
    const metric = metrics.find((m) => m.key === one.typeKey);
    return metric?.correlatable && metric.valueKind !== "categorical";
  });
  const topFindings = correlateAll(correlatable, { minOverlap: 14, maxLag: 2 }).slice(0, 3);

  return (
    <div className="space-y-10">
      <section>
        <SectionHeading
          title="Dashboard"
          description={
            range
              ? `${range.days} days of data, ${formatDate(range.from)} to ${formatDate(range.to)}.`
              : undefined
          }
        />
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {metrics.slice(0, 9).map((metric) => {
            const one = seriesByKey.get(metric.key);
            const summary = one ? summarize(one) : null;
            return (
              <Card key={metric.key} className="rise">
                <div className="flex items-start justify-between gap-3">
                  <Stat
                    label={metric.label}
                    value={formatNumber(metric.latestValue, metric.unit)}
                    hint={
                      summary
                        ? `avg ${formatNumber(summary.mean, metric.unit)} over ${summary.n} days`
                        : undefined
                    }
                  />
                  {summary?.recentChangePct !== null && summary?.recentChangePct !== undefined ? (
                    <Badge
                      tone={
                        // Colour by whether the change is good for *this*
                        // metric, not by its sign — a falling resting heart
                        // rate is an improvement.
                        metric.polarity === 0
                          ? "neutral"
                          : summary.recentChangePct * metric.polarity > 0
                            ? "positive"
                            : "negative"
                      }
                    >
                      {summary.recentChangePct > 0 ? "↑" : "↓"}{" "}
                      {Math.abs(summary.recentChangePct).toFixed(0)}%
                    </Badge>
                  ) : null}
                </div>
                {one ? <MetricSparkline series={[...one.points.entries()]} /> : null}
              </Card>
            );
          })}
        </div>
      </section>

      {topFindings.length > 0 ? (
        <section>
          <SectionHeading
            title="Strongest patterns"
            description="The relationships with the largest coefficients right now."
            action={
              <Link href="/insights" className="text-sm font-medium text-accent hover:underline">
                All insights →
              </Link>
            }
          />
          <div className="grid gap-3">
            {topFindings.map((finding) => {
              const a = metrics.find((m) => m.key === finding.a);
              const b = metrics.find((m) => m.key === finding.b);
              return (
                <Card
                  key={`${finding.a}-${finding.b}-${finding.lag}`}
                  className="flex flex-wrap items-center justify-between gap-3"
                >
                  <p className="text-sm">
                    <span className="font-medium">{a?.label ?? finding.a}</span>
                    <span className="text-muted"> and </span>
                    <span className="font-medium">{b?.label ?? finding.b}</span>
                    <span className="text-muted">
                      {" "}
                      move {finding.pearson > 0 ? "together" : "in opposite directions"} (
                      {describeLag(finding.lag)}, n={finding.n})
                    </span>
                  </p>
                  <span
                    className="tnum text-sm font-semibold"
                    style={{ color: finding.pearson > 0 ? "var(--positive)" : "var(--negative)" }}
                  >
                    r = {finding.pearson.toFixed(2)}
                  </span>
                </Card>
              );
            })}
          </div>
        </section>
      ) : null}
    </div>
  );
}
