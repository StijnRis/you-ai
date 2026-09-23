import Link from "next/link";
import { requireUser } from "@/lib/auth";
import { getDailySeries, getDataRange, getMetricOverview } from "@/lib/db/queries";
import { correlateAll } from "@/lib/stats/correlate";
import { EmptyState, SectionHeading } from "@/components/ui";
import { InsightsView } from "@/components/insights-view";
import { formatDate } from "@/lib/utils";
import { getSettings } from "@/lib/settings";

export default async function InsightsPage() {
  const user = await requireUser();
  const [metrics, series, range, settings] = await Promise.all([
    getMetricOverview(user.id),
    getDailySeries(user.id),
    getDataRange(user.id),
    getSettings(),
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
  const results = correlateAll(correlatable, {
    // A floor below the admin's minimum, so the slider can still be dragged
    // down from the default without a round trip.
    minOverlap: Math.min(10, settings.correlationMinOverlap),
    maxLag: settings.correlationMaxLag,
    alpha: settings.correlationAlpha,
  });

  return (
    <>
      <SectionHeading
        title="Insights"
        description={
          range
            ? `Every pair of metrics, tested at shifts of up to ${settings.correlationMaxLag} days across ${range.days} days (${formatDate(range.from)} – ${formatDate(range.to)}).`
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
        defaultMinOverlap={settings.correlationMinOverlap}
        storageKey={`youai:important-correlations:${user.id}`}
        series={correlatable.map((one) => ({
          key: one.typeKey,
          points: [...one.points.entries()],
        }))}
      />
    </>
  );
}
