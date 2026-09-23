import Link from "next/link";
import { requireUser } from "@/lib/auth";
import {
  getDailySeries,
  getDataRange,
  getEventCounts,
  getMetricOverview,
  listSources,
} from "@/lib/db/queries";
import { Card, EmptyState, SectionHeading, Stat } from "@/components/ui";
import { MetricSparkline } from "@/components/charts";
import { formatDate, formatNumber } from "@/lib/utils";

export default async function DataPage() {
  const user = await requireUser();
  const [metrics, range, counts, sourceRows, series] = await Promise.all([
    getMetricOverview(user.id),
    getDataRange(user.id),
    getEventCounts(user.id),
    listSources(user.id),
    getDailySeries(user.id),
  ]);

  if (metrics.length === 0) {
    return (
      <>
        <SectionHeading title="Your data" description="Everything stored for you, per metric." />
        <EmptyState
          title="No data yet"
          description="Connect a source — or the sample data, to look around first — or import an export."
          action={
            <Link
              href="/sources"
              className="rounded-lg bg-text px-4 py-2 text-sm font-medium text-bg hover:opacity-90"
            >
              Go to Sources
            </Link>
          }
        />
      </>
    );
  }

  const sourceLabel = new Map(sourceRows.map((row) => [row.id, row.label]));
  const seriesByKey = new Map(series.map((one) => [one.typeKey, one]));
  const totalRecords = counts.reduce((sum, row) => sum + row.events, 0);

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

  return (
    <div className="space-y-10">
      <section>
        <SectionHeading
          title="Your data"
          description={
            range ? `${formatDate(range.from)} to ${formatDate(range.to)}, in ${user.timezone}.` : undefined
          }
        />
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <Card>
            <Stat label="Records" value={totalRecords.toLocaleString()} />
          </Card>
          <Card>
            <Stat label="Metrics" value={metrics.length} />
          </Card>
          <Card>
            <Stat label="Days covered" value={range?.days ?? 0} />
          </Card>
          <Card>
            <Stat label="Sources" value={sourceRows.length} hint={<Link href="/sources" className="hover:underline">Manage →</Link>} />
          </Card>
        </div>
      </section>

      {[...byCategory.entries()].map(([category, group]) => (
        <section key={category}>
          <SectionHeading title={category.charAt(0).toUpperCase() + category.slice(1)} />
          <Card className="overflow-x-auto p-0">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border text-left text-xs uppercase tracking-wide text-subtle">
                  <th className="px-5 py-2.5 font-medium">Metric</th>
                  <th className="px-3 py-2.5 font-medium">Source</th>
                  <th className="px-3 py-2.5 text-right font-medium">Records</th>
                  <th className="px-3 py-2.5 text-right font-medium">Days</th>
                  <th className="px-3 py-2.5 font-medium">Range</th>
                  <th className="px-3 py-2.5 text-right font-medium">Average</th>
                  <th className="px-3 py-2.5 text-right font-medium">Latest</th>
                  <th className="w-40 px-5 py-2.5 font-medium">Last 60 days</th>
                </tr>
              </thead>
              <tbody>
                {group.map((metric) => {
                  const info = perMetric.get(metric.key);
                  const one = seriesByKey.get(metric.key);
                  return (
                    <tr key={metric.key} className="border-b border-border last:border-0">
                      <td className="px-5 py-3">
                        <p className="font-medium">{metric.label}</p>
                        <p className="font-mono text-xs text-subtle">{metric.key}</p>
                      </td>
                      <td className="px-3 py-3 text-muted">{info ? [...info.sources].join(", ") : "—"}</td>
                      <td className="tnum px-3 py-3 text-right">{(info?.records ?? 0).toLocaleString()}</td>
                      <td className="tnum px-3 py-3 text-right">{metric.days}</td>
                      <td className="px-3 py-3 text-muted">
                        {metric.firstDate && metric.lastDate
                          ? `${formatDate(metric.firstDate)} – ${formatDate(metric.lastDate)}`
                          : "—"}
                      </td>
                      <td className="tnum px-3 py-3 text-right">{formatNumber(metric.average, metric.unit)}</td>
                      <td className="tnum px-3 py-3 text-right">{formatNumber(metric.latestValue, metric.unit)}</td>
                      <td className="px-5 py-1">
                        {one ? <MetricSparkline series={[...one.points.entries()]} unit={metric.unit} /> : null}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </Card>
        </section>
      ))}
    </div>
  );
}
