"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Check, Loader2, Mail } from "lucide-react";
import { cn } from "@/lib/utils";
import { MOOD_SCALE } from "@/lib/mood/types";

/**
 * The check-in itself: pick a face, optionally say why, save.
 *
 * Ten buttons rather than a slider — a slider invites fiddling for a precision
 * nobody has about their own mood, and a tap is one gesture on a phone.
 */
export function MoodLogger({ initial }: { initial: number | null }) {
  const router = useRouter();
  const [value, setValue] = useState<number | null>(initial);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save() {
    if (value === null) return;
    setBusy(true);
    setError(null);
    setSaved(false);

    try {
      const response = await fetch("/api/mood", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ value, note: note.trim() || undefined }),
      });
      const payload = await response.json();
      if (payload.error) throw new Error(payload.error);

      setNote("");
      setSaved(true);
      router.refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-1.5">
        {MOOD_SCALE.map((entry) => (
          <button
            key={entry.value}
            type="button"
            onClick={() => {
              setValue(entry.value);
              setSaved(false);
            }}
            aria-pressed={value === entry.value}
            title={`${entry.value} — ${entry.label}`}
            className={cn(
              "flex size-12 flex-col items-center justify-center rounded-xl border text-xl transition-all",
              value === entry.value
                ? "border-text bg-surface-2 scale-105"
                : "border-border hover:border-border-strong hover:bg-surface-2/60",
            )}
          >
            <span aria-hidden>{entry.emoji}</span>
            <span className="text-[10px] font-medium text-muted">{entry.value}</span>
          </button>
        ))}
      </div>

      <div className="flex flex-wrap items-end gap-3">
        <label className="block flex-1 text-xs text-muted">
          What is behind it? (optional)
          <input
            value={note}
            onChange={(event) => setNote(event.target.value)}
            maxLength={280}
            placeholder="Slept badly, good run, shipped the thing…"
            className="mt-1 block h-9 w-full rounded-lg border border-border bg-surface px-2.5 text-sm text-text outline-none focus:border-border-strong"
          />
        </label>

        <button
          onClick={save}
          disabled={value === null || busy}
          className="flex h-9 items-center gap-2 rounded-lg bg-text px-4 text-sm font-medium text-bg transition-opacity hover:opacity-90 disabled:opacity-30"
        >
          {busy ? <Loader2 className="size-3.5 animate-spin" aria-hidden /> : null}
          {saved && !busy ? <Check className="size-3.5" aria-hidden /> : null}
          {saved && !busy ? "Logged" : "Log mood"}
        </button>
      </div>

      {error ? <p className="text-sm text-danger">{error}</p> : null}
      <p className="text-xs text-muted">
        Check in as often as you like — the day&rsquo;s readings average into one number.
      </p>
    </div>
  );
}

/**
 * Opt in or out of the mood email.
 *
 * There is no scheduler on this deployment, so there is no hour to choose —
 * an admin sends the digest to everyone who has opted in. The stored value is
 * still the hour column (null means off), so a per-person schedule can come
 * back without a migration.
 */
export function MoodEmailSettings({
  initialHour,
  configured,
}: {
  initialHour: number | null;
  configured: boolean;
}) {
  const router = useRouter();
  const [hour, setHour] = useState<number | null>(initialHour);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  async function update(next: number | null) {
    setHour(next);
    setBusy(true);
    setError(null);
    setSaved(false);

    try {
      const response = await fetch("/api/mood", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ moodEmailHour: next }),
      });
      const payload = await response.json();
      if (payload.error) throw new Error(payload.error);
      setSaved(true);
      router.refresh();
    } catch (cause) {
      setHour(initialHour);
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-3">
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={hour !== null}
            onChange={(event) => update(event.target.checked ? 8 : null)}
            className="size-4 rounded border-border"
          />
          Send me the mood email
        </label>

        {busy ? <Loader2 className="size-3.5 animate-spin text-muted" aria-hidden /> : null}
        {saved && !busy ? <Check className="size-3.5 text-positive" aria-hidden /> : null}
      </div>

      {error ? <p className="text-sm text-danger">{error}</p> : null}

      {!configured && hour !== null ? (
        <p className="flex items-start gap-1.5 text-xs text-muted">
          <Mail className="mt-0.5 size-3.5 shrink-0" aria-hidden />
          RESEND_API_KEY is not set on this deployment, so nothing will actually send yet.
        </p>
      ) : null}
    </div>
  );
}
