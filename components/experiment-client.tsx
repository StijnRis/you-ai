"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Check, Loader2, X } from "lucide-react";
import { cn } from "@/lib/utils";

async function send(url: string, method: string, body?: unknown): Promise<void> {
  const response = await fetch(url, {
    method,
    headers: { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (!response.ok) {
    const payload = await response.json().catch(() => ({}));
    throw new Error(payload.error ?? `Request failed (${response.status})`);
  }
}

/** Today's yes/no. The one interaction that has to be effortless, every day. */
export function CheckinToday({
  experimentId,
  done,
  compact,
}: {
  experimentId: string;
  done: boolean | null;
  compact?: boolean;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState<boolean | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function checkin(value: boolean) {
    setBusy(value);
    setError(null);
    try {
      await send(`/api/experiments/${experimentId}/checkin`, "POST", { done: value });
      router.refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      {compact ? null : <span className="text-sm text-muted">Did you do it today?</span>}
      <button
        onClick={() => checkin(true)}
        disabled={busy !== null}
        aria-pressed={done === true}
        className={cn(
          "flex h-8 items-center gap-1.5 rounded-lg border px-3 text-sm transition-colors disabled:opacity-50",
          done === true
            ? "border-transparent bg-positive/15 text-positive"
            : "border-border hover:bg-surface-2",
        )}
      >
        {busy === true ? <Loader2 className="size-3.5 animate-spin" aria-hidden /> : <Check className="size-3.5" aria-hidden />}
        Done
      </button>
      <button
        onClick={() => checkin(false)}
        disabled={busy !== null}
        aria-pressed={done === false}
        className={cn(
          "flex h-8 items-center gap-1.5 rounded-lg border px-3 text-sm transition-colors disabled:opacity-50",
          done === false
            ? "border-transparent bg-negative/15 text-negative"
            : "border-border hover:bg-surface-2",
        )}
      >
        {busy === false ? <Loader2 className="size-3.5 animate-spin" aria-hidden /> : <X className="size-3.5" aria-hidden />}
        Skipped
      </button>
      {error ? <span className="text-xs text-danger">{error}</span> : null}
    </div>
  );
}

export type DayCell = { date: string; label: string; done: boolean | null; future: boolean };

/**
 * One square per day of the experiment. Clicking cycles a past day through
 * done → skipped, so a forgotten check-in can be filled in afterwards.
 */
export function CheckinGrid({ experimentId, days }: { experimentId: string; days: DayCell[] }) {
  const router = useRouter();
  const [pending, setPending] = useState<string | null>(null);

  async function toggle(day: DayCell) {
    if (day.future || pending) return;
    setPending(day.date);
    try {
      await send(`/api/experiments/${experimentId}/checkin`, "POST", {
        date: day.date,
        done: day.done !== true,
      });
      router.refresh();
    } finally {
      setPending(null);
    }
  }

  return (
    <div className="flex flex-wrap gap-1.5">
      {days.map((day) => (
        <button
          key={day.date}
          onClick={() => toggle(day)}
          disabled={day.future}
          title={`${day.label}: ${day.future ? "upcoming" : day.done === true ? "done" : day.done === false ? "skipped" : "no check-in"}`}
          className={cn(
            "flex size-10 flex-col items-center justify-center rounded-lg border text-[10px] leading-tight transition-colors",
            day.future && "border-dashed border-border text-subtle",
            !day.future && day.done === null && "border-border text-muted hover:bg-surface-2",
            day.done === true && "border-transparent bg-positive/20 text-positive",
            day.done === false && "border-transparent bg-negative/15 text-negative",
            pending === day.date && "animate-pulse",
          )}
        >
          <span className="font-medium">{day.label.split(" ")[1]}</span>
          <span>{day.label.split(" ")[0]}</span>
        </button>
      ))}
    </div>
  );
}

export function ExperimentActions({
  experimentId,
  phase,
  conclusion,
}: {
  experimentId: string;
  phase: "scheduled" | "running" | "finished" | "abandoned";
  conclusion: string | null;
}) {
  const router = useRouter();
  const [draft, setDraft] = useState(conclusion ?? "");
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function run(key: string, action: () => Promise<void>) {
    setBusy(key);
    setError(null);
    try {
      await action();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(null);
    }
  }

  const change = (action: string, extra: Record<string, unknown> = {}) =>
    run(action, async () => {
      await send(`/api/experiments/${experimentId}`, "PATCH", { action, ...extra });
      router.refresh();
    });

  const remove = () =>
    run("delete", async () => {
      if (!window.confirm("Delete this experiment and its check-ins?")) return;
      await send(`/api/experiments/${experimentId}`, "DELETE");
      router.push("/experiments");
      router.refresh();
    });

  const buttonClass =
    "flex h-8 items-center gap-1.5 rounded-lg border border-border px-3 text-sm transition-colors hover:bg-surface-2 disabled:opacity-50";

  return (
    <div className="space-y-4">
      {phase === "finished" || phase === "abandoned" ? (
        <div className="space-y-2">
          <label htmlFor="conclusion" className="block text-sm font-medium">
            Your conclusion
          </label>
          <textarea
            id="conclusion"
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            rows={3}
            placeholder="What did you learn? Will you keep doing it?"
            className="block w-full resize-y rounded-lg border border-border bg-surface px-3 py-2 text-sm outline-none focus:border-border-strong"
          />
          <button
            onClick={() => change("conclude", { conclusion: draft })}
            disabled={busy !== null || draft === (conclusion ?? "")}
            className="flex h-8 items-center gap-2 rounded-lg bg-text px-4 text-sm font-medium text-bg transition-opacity hover:opacity-90 disabled:opacity-30"
          >
            {busy === "conclude" ? <Loader2 className="size-3.5 animate-spin" aria-hidden /> : null}
            Save conclusion
          </button>
        </div>
      ) : null}

      <div className="flex flex-wrap gap-2">
        {phase === "running" ? (
          <button onClick={() => change("end_now")} disabled={busy !== null} className={buttonClass}>
            {busy === "end_now" ? <Loader2 className="size-3.5 animate-spin" aria-hidden /> : null}
            End today
          </button>
        ) : null}
        {phase === "running" || phase === "scheduled" ? (
          <button onClick={() => change("abandon")} disabled={busy !== null} className={buttonClass}>
            {busy === "abandon" ? <Loader2 className="size-3.5 animate-spin" aria-hidden /> : null}
            Abandon
          </button>
        ) : null}
        <button
          onClick={remove}
          disabled={busy !== null}
          className={cn(buttonClass, "text-danger hover:bg-danger/5")}
        >
          {busy === "delete" ? <Loader2 className="size-3.5 animate-spin" aria-hidden /> : null}
          Delete
        </button>
      </div>

      {error ? <p className="text-sm text-danger">{error}</p> : null}
    </div>
  );
}
