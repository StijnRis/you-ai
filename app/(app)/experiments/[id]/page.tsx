import type { ReactNode } from "react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, ExternalLink, MessageSquare } from "lucide-react";
import { requireUser } from "@/lib/auth";
import { eachLocalDate } from "@/lib/events/time";
import { durationOf, type WindowStats } from "@/lib/experiments/analyze";
import { getExperimentReport } from "@/lib/experiments/store";
import { formatDate, formatNumber, formatP } from "@/lib/utils";
import { Card, SectionHeading } from "@/components/ui";
import { PhaseBadge, VerdictBadge, shortDay } from "@/components/experiment-view";
import { CheckinGrid, CheckinToday, ExperimentActions } from "@/components/experiment-client";
import { EvaluatePanel } from "@/components/experiment-evaluation";

export default async function ExperimentPage(props: PageProps<"/experiments/[id]">) {
  const user = await requireUser();
  const { id } = await props.params;
  const result = await getExperimentReport(user.id, id, user.timezone);

  if (!result) notFound();

  const { experiment, phase, today, checkins, report } = result;
  const byDate = new Map(checkins.map((c) => [c.localDate, c.done]));
  const days = eachLocalDate(experiment.startDate, experiment.endDate).map((date) => ({
    date,
    label: shortDay(date),
    done: byDate.get(date) ?? null,
    future: date > today,
  }));
  const showAfter = report.outcomes.some((outcome) => outcome.after.n > 0);
  const askPrompt = `How did my experiment "${experiment.title}" go? What does the data say?`;

  return (
    <>
      <Link
        href="/experiments"
        className="mb-5 inline-flex items-center gap-1.5 text-sm text-muted hover:text-text"
      >
        <ArrowLeft className="size-3.5" aria-hidden />
        All experiments
      </Link>

      <SectionHeading
        title={experiment.title}
        description={`${formatDate(experiment.startDate)} – ${formatDate(experiment.endDate)} · ${durationOf(experiment)} days`}
        action={<PhaseBadge phase={phase} />}
      />

      <div className="space-y-6">
        <Card className="space-y-4">
          <Field label="What to do each day">{experiment.intervention}</Field>
          <Field label="Hypothesis">{experiment.hypothesis}</Field>
          {experiment.rationale ? <Field label="Why">{experiment.rationale}</Field> : null}
          {experiment.sources.length > 0 ? (
            <Field label="Sources">
              <ul className="space-y-1">
                {experiment.sources.map((source) => (
                  <li key={source.url}>
                    <a
                      href={source.url}
                      target="_blank"
                      rel="noreferrer"
                      className="inline-flex items-center gap-1.5 text-accent hover:underline"
                    >
                      {source.title}
                      <ExternalLink className="size-3" aria-hidden />
                    </a>
                  </li>
                ))}
              </ul>
            </Field>
          ) : null}
        </Card>

        <Card className="space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h3 className="font-medium">Check-ins</h3>
            <p className="text-xs text-muted">
              {report.adherence.daysElapsed > 0
                ? `Done on ${report.adherence.daysDone} of ${report.adherence.daysElapsed} days so far`
                : `Starts ${formatDate(experiment.startDate)}`}
            </p>
          </div>
          {phase === "running" ? (
            <CheckinToday experimentId={experiment.id} done={byDate.get(today) ?? null} />
          ) : null}
          <CheckinGrid experimentId={experiment.id} days={days} />
          <p className="text-xs text-subtle">Click a past day to fill in or correct it.</p>
        </Card>

        <Card className="space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h3 className="font-medium">Results</h3>
              <p className="mt-0.5 text-xs text-muted">
                Baseline {formatDate(report.windows.baseline.from)} – {formatDate(report.windows.baseline.to)}
                {report.windows.during
                  ? ` · during ${formatDate(report.windows.during.from)} – ${formatDate(report.windows.during.to)}`
                  : ""}
                {report.windows.after
                  ? ` · after ${formatDate(report.windows.after.from)} – ${formatDate(report.windows.after.to)}`
                  : ""}
              </p>
            </div>
            <Link
              href={`/chat?q=${encodeURIComponent(askPrompt)}`}
              className="flex h-8 items-center gap-1.5 rounded-lg border border-border px-3 text-sm transition-colors hover:bg-surface-2"
            >
              <MessageSquare className="size-3.5" aria-hidden />
              Ask the AI about it
            </Link>
          </div>

          {report.outcomes.length === 0 ? (
            <p className="text-sm text-muted">This experiment has no metrics to measure.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border text-left text-xs uppercase tracking-wide text-subtle">
                    <th className="py-2 pr-4 font-medium">Metric</th>
                    <th className="py-2 pr-4 font-medium">Before</th>
                    <th className="py-2 pr-4 font-medium">During</th>
                    <th className="py-2 pr-4 font-medium">Change</th>
                    {showAfter ? <th className="py-2 pr-4 font-medium">After</th> : null}
                    <th className="py-2 font-medium">Verdict</th>
                  </tr>
                </thead>
                <tbody>
                  {report.outcomes.map((outcome) => (
                    <tr key={outcome.metric} className="border-b border-border last:border-0">
                      <td className="py-2.5 pr-4">
                        <p className="font-medium">{outcome.label}</p>
                        <p className="font-mono text-xs text-subtle">{outcome.metric}</p>
                      </td>
                      <td className="tnum py-2.5 pr-4">
                        <WindowCell stats={outcome.baseline} unit={outcome.unit} />
                      </td>
                      <td className="tnum py-2.5 pr-4">
                        <WindowCell stats={outcome.during} unit={outcome.unit} />
                        {outcome.duringOnProtocol && outcome.duringOnProtocol.n > 0 ? (
                          <p className="text-xs text-subtle">
                            {formatNumber(outcome.duringOnProtocol.mean, outcome.unit)} on days done
                          </p>
                        ) : null}
                      </td>
                      <td className="tnum py-2.5 pr-4">
                        {formatPct(outcome.changePct)}
                        {outcome.pValue !== null ? (
                          <p className="text-xs text-subtle">
                            {formatP(outcome.pValue)}
                            {outcome.effectSize !== null ? ` · d = ${outcome.effectSize.toFixed(2)}` : ""}
                          </p>
                        ) : null}
                      </td>
                      {showAfter ? (
                        <td className="tnum py-2.5 pr-4">
                          <WindowCell stats={outcome.after} unit={outcome.unit} />
                          {outcome.afterChangePct !== null ? (
                            <p className="text-xs text-subtle">{formatPct(outcome.afterChangePct)} vs before</p>
                          ) : null}
                        </td>
                      ) : null}
                      <td className="py-2.5">
                        <VerdictBadge verdict={outcome.verdict} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          <p className="text-xs text-subtle">
            Averages per day, compared with a Welch t-test. This is a before/after comparison with no
            control group, so anything else that changed in the same days can explain a difference —
            and a short experiment can miss a real but small effect.
          </p>
        </Card>

        <EvaluatePanel
          experimentId={experiment.id}
          phase={phase}
          evaluation={experiment.evaluation}
          metricLabels={Object.fromEntries(
            report.outcomes.map((outcome) => [outcome.metric, outcome.label]),
          )}
        />

        <Card>
          <ExperimentActions
            experimentId={experiment.id}
            phase={phase}
            conclusion={experiment.conclusion}
          />
        </Card>
      </div>
    </>
  );
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div>
      <p className="text-xs font-medium uppercase tracking-wide text-subtle">{label}</p>
      <div className="mt-1 text-sm leading-relaxed">{children}</div>
    </div>
  );
}

function WindowCell({ stats, unit }: { stats: WindowStats; unit: string | null }) {
  if (stats.n === 0) return <span className="text-subtle">—</span>;
  return (
    <>
      {formatNumber(stats.mean, unit)}
      <p className="text-xs text-subtle">
        {stats.n} {stats.n === 1 ? "day" : "days"}
      </p>
    </>
  );
}

function formatPct(value: number | null): string {
  if (value === null) return "—";
  return `${value > 0 ? "+" : ""}${value.toFixed(1)}%`;
}
