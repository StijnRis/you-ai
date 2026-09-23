import Link from "next/link";
import { requireUser } from "@/lib/auth";
import { eachLocalDate } from "@/lib/events/time";
import { durationOf, phaseOf } from "@/lib/experiments/analyze";
import { listCheckins, listExperiments, todayFor } from "@/lib/experiments/store";
import { formatDate } from "@/lib/utils";
import { Card, EmptyState, SectionHeading } from "@/components/ui";
import { PhaseBadge } from "@/components/experiment-view";
import { CheckinToday } from "@/components/experiment-client";

const DESIGN_PROMPT = "I want to run an experiment to improve something. Can you research ideas and help me design one?";

export default async function ExperimentsPage() {
  const user = await requireUser();
  const today = todayFor(user.timezone);
  const rows = await listExperiments(user.id);

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
      };
    }),
  );

  const designLink = (
    <Link
      href={`/chat?q=${encodeURIComponent(DESIGN_PROMPT)}`}
      className="rounded-lg bg-text px-4 py-2 text-sm font-medium text-bg hover:opacity-90"
    >
      Design one with the AI
    </Link>
  );

  return (
    <>
      <SectionHeading
        title="Experiments"
        description="Change one thing for a set number of days, then see what it did. Each experiment is measured against the same number of days right before it started."
        action={items.length > 0 ? designLink : undefined}
      />

      {items.length === 0 ? (
        <EmptyState
          title="No experiments yet"
          description="Tell the AI what you want to improve — more exercise, better sleep, a steadier mood. It searches for evidence-backed ideas and sets up an experiment measured on the data you already track."
          action={designLink}
        />
      ) : (
        <div className="space-y-2">
          {items.map(({ row, phase, daysIn, todayDone, doneCount }) => (
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
                </Link>
                <PhaseBadge phase={phase} />
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
    </>
  );
}
