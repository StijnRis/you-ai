import Link from "next/link";
import { requireUser } from "@/lib/auth";
import { getMetricOverview } from "@/lib/db/queries";
import { eachLocalDate } from "@/lib/events/time";
import { durationOf, phaseOf } from "@/lib/experiments/analyze";
import { awaitsEvaluation, listCheckins, listExperiments, todayFor } from "@/lib/experiments/store";
import { formatDate } from "@/lib/utils";
import { Badge, Card, SectionHeading } from "@/components/ui";
import { PhaseBadge } from "@/components/experiment-view";
import { VerdictHeadline } from "@/components/experiment-evaluation";
import { CheckinToday } from "@/components/experiment-client";
import { DesignChat } from "@/components/experiment-design";

export default async function ExperimentsPage() {
  const user = await requireUser();
  const today = todayFor(user.timezone);
  const [rows, metrics] = await Promise.all([
    listExperiments(user.id),
    getMetricOverview(user.id),
  ]);

  const items = await Promise.all(
    rows.map(async (row) => {
      const phase = phaseOf(row, today);
      const checkins = phase === "running" ? await listCheckins(row.id) : [];
      const daysIn = phase === "running" ? eachLocalDate(row.startDate, today).length : 0;
      return {
        row,
        phase,
        daysIn,
        todayDone: checkins.find((c) => c.localDate === today)?.done ?? null,
        doneCount: checkins.filter((c) => c.done).length,
        needsEvaluation: awaitsEvaluation(row, today),
      };
    }),
  );

  const waiting = items.filter((item) => item.needsEvaluation);

  return (
    <>
      <SectionHeading
        title="Experiments"
        description="Change one thing for a set number of days, then see what it did. Each experiment is measured against the same number of days right before it started."
      />

      {waiting.length > 0 ? (
        <Card className="mb-6 border-accent/40 bg-accent-soft/30">
          <p className="text-sm font-medium">
            {waiting.length === 1
              ? "One experiment has finished and is waiting for you."
              : `${waiting.length} experiments have finished and are waiting for you.`}
          </p>
          <p className="mt-1 text-sm text-muted">
            The data for the whole window is in. Open one to get the verdict on whether it helped.
          </p>
          <div className="mt-3 flex flex-wrap gap-2">
            {waiting.map((item) => (
              <Link
                key={item.row.id}
                href={`/experiments/${item.row.id}`}
                className="rounded-lg bg-text px-3 py-1.5 text-sm font-medium text-bg transition-opacity hover:opacity-90"
              >
                Evaluate “{item.row.title}”
              </Link>
            ))}
          </div>
        </Card>
      ) : null}

      <DesignChat
        metrics={metrics.map((metric) => ({
          key: metric.key,
          label: metric.label,
          days: metric.days,
        }))}
        hasExperiments={items.length > 0}
      />

      <div className="mt-8">
        <h2 className="mb-3 text-sm font-medium">
          {items.length === 0
            ? "Your experiments"
            : `Your experiments (${items.length})`}
        </h2>

        {items.length === 0 ? (
          <Card>
            <p className="py-6 text-center text-sm text-muted">
              Nothing yet. Describe what you want to improve above and the AI will design the first
              one from the data you already have.
            </p>
          </Card>
        ) : (
          <div className="space-y-2">
            {items.map(({ row, phase, daysIn, todayDone, doneCount, needsEvaluation }) => (
              <Card key={row.id} className="transition-colors hover:border-border-strong">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <Link href={`/experiments/${row.id}`} className="min-w-0 flex-1">
                    <p className="font-medium">{row.title}</p>
                    <p className="mt-0.5 text-sm text-muted">{row.intervention}</p>
                    <p className="mt-1.5 text-xs text-subtle">
                      {formatDate(row.startDate)} – {formatDate(row.endDate)} · {durationOf(row)} days
                      {phase === "running" ? ` · day ${daysIn} · done ${doneCount}×` : ""}
                      {row.targetMetrics.length ? ` · measuring ${row.targetMetrics.join(", ")}` : ""}
                    </p>
                    {row.evaluation ? (
                      <p className="mt-2 text-sm">{row.evaluation.headline}</p>
                    ) : null}
                  </Link>
                  <div className="flex shrink-0 flex-wrap items-center gap-2">
                    {row.evaluation ? <VerdictHeadline verdict={row.evaluation.verdict} /> : null}
                    {needsEvaluation ? <Badge tone="accent">ready to evaluate</Badge> : null}
                    <PhaseBadge phase={phase} />
                  </div>
                </div>
                {phase === "running" ? (
                  <div className="mt-4 border-t border-border pt-4">
                    <CheckinToday experimentId={row.id} done={todayDone} />
                  </div>
                ) : null}
              </Card>
            ))}
          </div>
        )}
      </div>
    </>
  );
}
