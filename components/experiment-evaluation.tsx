"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2, RefreshCw, Sparkles } from "lucide-react";
import type { ExperimentEvaluation } from "@/lib/db/schema";
import { Badge, Card } from "@/components/ui";

const VERDICT = {
  helped: { label: "It helped", tone: "positive" },
  worsened: { label: "It made things worse", tone: "negative" },
  no_change: { label: "No real change", tone: "neutral" },
  inconclusive: { label: "Not enough to say", tone: "neutral" },
} as const;

export function VerdictHeadline({ verdict }: { verdict: ExperimentEvaluation["verdict"] }) {
  return <Badge tone={VERDICT[verdict].tone}>{VERDICT[verdict].label}</Badge>;
}

/**
 * The payoff screen: one button that reads the finished experiment and says
 * whether it worked. The statistics are already on the page above this — what
 * this adds is the judgement, in a sentence, which is the part people actually
 * want and the part a table cannot give them.
 */
export function EvaluatePanel({
  experimentId,
  phase,
  evaluation,
  metricLabels,
}: {
  experimentId: string;
  phase: "scheduled" | "running" | "finished" | "abandoned";
  evaluation: ExperimentEvaluation | null;
  metricLabels: Record<string, string>;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<ExperimentEvaluation | null>(evaluation);

  const canEvaluate = phase === "finished" || phase === "abandoned";

  async function evaluate() {
    setBusy(true);
    setError(null);
    try {
      const response = await fetch(`/api/experiments/${experimentId}/evaluate`, { method: "POST" });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error ?? `Request failed (${response.status})`);
      setResult(payload.evaluation);
      // Clears the count on the Experiments tab.
      router.refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(false);
    }
  }

  if (!canEvaluate) {
    return (
      <Card>
        <h3 className="font-medium">Did it help?</h3>
        <p className="mt-1 text-sm text-muted">
          {phase === "scheduled"
            ? "You will be able to evaluate this once it has run."
            : "Still running — the verdict unlocks when it finishes, so it is read on the full window rather than half of one."}
        </p>
      </Card>
    );
  }

  return (
    <Card className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="font-medium">Did it help?</h3>
          <p className="mt-0.5 text-sm text-muted">
            The AI reads the numbers above — the change, the p-value and how often you did it — and
            gives you a straight answer.
          </p>
        </div>
        <button
          onClick={evaluate}
          disabled={busy}
          className="flex h-8 shrink-0 items-center gap-2 rounded-lg bg-text px-4 text-sm font-medium text-bg transition-opacity hover:opacity-90 disabled:opacity-40"
        >
          {busy ? (
            <Loader2 className="size-3.5 animate-spin" aria-hidden />
          ) : result ? (
            <RefreshCw className="size-3.5" aria-hidden />
          ) : (
            <Sparkles className="size-3.5" aria-hidden />
          )}
          {busy ? "Reading the data…" : result ? "Re-evaluate" : "Evaluate"}
        </button>
      </div>

      {error ? <p className="text-sm text-danger">{error}</p> : null}

      {result ? (
        <div className="space-y-4 border-t border-border pt-4">
          <div className="flex flex-wrap items-center gap-2">
            <VerdictHeadline verdict={result.verdict} />
            <p className="text-sm font-medium">{result.headline}</p>
          </div>

          <p className="text-sm leading-relaxed text-muted">{result.detail}</p>

          {result.perMetric.length > 0 ? (
            <dl className="space-y-2">
              {result.perMetric.map((entry) => (
                <div key={entry.metric} className="text-sm">
                  <dt className="font-medium">{metricLabels[entry.metric] ?? entry.metric}</dt>
                  <dd className="text-muted">{entry.note}</dd>
                </div>
              ))}
            </dl>
          ) : null}

          <div>
            <p className="text-xs font-medium uppercase tracking-wide text-subtle">What to do now</p>
            <p className="mt-1 text-sm leading-relaxed">{result.recommendation}</p>
          </div>

          {result.caveat ? (
            <p className="rounded-lg bg-surface-2 px-3 py-2 text-xs leading-relaxed text-muted">
              {result.caveat}
            </p>
          ) : null}
        </div>
      ) : null}
    </Card>
  );
}
