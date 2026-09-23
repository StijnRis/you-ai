import Link from "next/link";
import { requireUser } from "@/lib/auth";
import { getDailySeries, getDataRange, getMetricOverview } from "@/lib/db/queries";
import { correlateAll } from "@/lib/stats/correlate";
import { EmptyState, SectionHeading } from "@/components/ui";
import { InsightsView } from "@/components/insights-view";
import { formatDate } from "@/lib/utils";

export default async function InsightsPage() {
  const user = await requireUser();
  const [metrics, series, range] = await Promise.all([
    getMetricOverview(user.id),
    getDailySeries(user.id),
    getDataRange(user.id),
  ]);

  const correlatable = series.filter((one) => {
    const metric = metrics.find((m) => m.key === one.typeKey);
    return metric?.correlatable && metric.valueKind !== "categorical";
  });

  if (correlatable.length < 2) {
    return (
      <>
        <SectionHeading title="Insights" />
        <EmptyState
          title="Not enough to correlate yet"
          description="Two metrics with at least a couple of weeks of overlapping days are needed before any relationship means anything. The weather adapter is the quickest way to get a second series."
          action={
            <Link
              href="/sources"
              className="rounded-lg bg-text px-4 py-2 text-sm font-medium text-bg hover:opacity-90"
            >
              Connect weather
            </Link>
          }
        />
      </>
    );
  }

  // Every pair at every lag. The client picks which to show; recomputing on
  // each filter change would mean a round trip per keystroke.
  const results = correlateAll(correlatable, { minOverlap: 10, maxLag: 3 });

  return (
    <>
      <SectionHeading
        title="Insights"
        description={
          range
            ? `Every pair of metrics, tested at shifts of up to three days across ${range.days} days (${formatDate(range.from)} – ${formatDate(range.to)}).`
            : undefined
        }
      />
      <InsightsView
        results={results}
        metrics={metrics.map((metric) => ({
          key: metric.key,
          label: metric.label,
          unit: metric.unit,
          category: metric.category,
        }))}
        series={correlatable.map((one) => ({
          key: one.typeKey,
          points: [...one.points.entries()],
        }))}
      />
    </>
  );
}
