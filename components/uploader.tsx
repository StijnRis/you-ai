"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { CheckCircle2, FileUp, Loader2, XCircle } from "lucide-react";
import Link from "next/link";
import { Badge, Card } from "@/components/ui";
import { cn } from "@/lib/utils";

type Outcome = {
  importId: string;
  filename: string;
  specId: string | null;
  matchKind: "fingerprint" | "builtin" | "inferred" | "skipped";
  skipReason?: string;
  spec: { name: string; provider: string; emit: { type: string }[] } | null;
  detection: { format: string; fields: string[]; recordCount: number; fingerprint: string } | null;
  stats: {
    recordsRead: number;
    eventsBuilt: number;
    eventsStored: number;
    skipped: number;
    dateRange: { from: string; to: string } | null;
    errors: { record: number; message: string }[];
  };
};

const MATCH_COPY = {
  fingerprint: "Reused a conversion stored for this exact file shape.",
  builtin: "Matched a conversion that ships with the app.",
  inferred: "New format — the model wrote a conversion for it, and it has been saved.",
  skipped: "Recognised, and deliberately not imported.",
} as const;

export function Uploader() {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);
  const [busy, setBusy] = useState(false);
  const [outcomes, setOutcomes] = useState<Outcome[] | null>(null);
  const [failures, setFailures] = useState<{ filename: string; error: string }[]>([]);
  const [error, setError] = useState<string | null>(null);

  const imported = (outcomes ?? []).filter((outcome) => outcome.matchKind !== "skipped");
  const skipped = (outcomes ?? []).filter((outcome) => outcome.matchKind === "skipped");
  const storedTotal = imported.reduce((sum, outcome) => sum + outcome.stats.eventsStored, 0);

  async function upload(files: File[]) {
    if (files.length === 0) return;
    setBusy(true);
    setError(null);
    setOutcomes(null);
    setFailures([]);

    const body = new FormData();
    for (const file of files) body.append("file", file);

    try {
      const response = await fetch("/api/import", { method: "POST", body });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error ?? "Import failed.");
      setOutcomes(payload.outcomes);
      setFailures(payload.failures ?? []);
      router.refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-4">
      <div
        onDragOver={(event) => {
          event.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(event) => {
          event.preventDefault();
          setDragging(false);
          void upload([...(event.dataTransfer.files ?? [])]);
        }}
        className={cn(
          "rounded-xl border border-dashed px-6 py-12 text-center transition-colors",
          dragging ? "border-accent bg-accent-soft/40" : "border-border-strong",
        )}
      >
        {busy ? (
          <p className="flex items-center justify-center gap-2 text-sm text-muted">
            <Loader2 className="size-4 animate-spin" aria-hidden />
            Detecting formats and converting…
          </p>
        ) : (
          <>
            <FileUp className="mx-auto size-6 text-subtle" aria-hidden />
            <p className="mt-3 text-sm font-medium">Drop a data export here</p>
            <p className="mx-auto mt-1 max-w-sm text-sm text-muted">
              CSV, TSV, JSON, NDJSON, XML, or a zip of them — Apple Health, Samsung Health,
              Google Takeout, Strava, or something we have never seen. A whole folder of
              files at once is fine.
            </p>
            <button
              onClick={() => inputRef.current?.click()}
              className="mt-4 rounded-lg border border-border px-3.5 py-2 text-sm font-medium transition-colors hover:bg-surface-2"
            >
              Choose files
            </button>
            <input
              ref={inputRef}
              type="file"
              className="sr-only"
              accept=".csv,.tsv,.json,.ndjson,.jsonl,.xml,.zip"
              multiple
              onChange={(event) => {
                void upload([...(event.target.files ?? [])]);
                event.target.value = "";
              }}
            />
          </>
        )}
      </div>

      {error ? (
        <Card className="border-danger/30 bg-danger/5">
          <p className="flex items-start gap-2 text-sm text-danger">
            <XCircle className="mt-0.5 size-4 shrink-0" aria-hidden />
            {error}
          </p>
        </Card>
      ) : null}

      {imported.length > 0 ? (
        <p className="text-sm text-muted">
          Imported <strong className="font-medium text-fg">{imported.length}</strong> file
          {imported.length === 1 ? "" : "s"}, storing{" "}
          <strong className="font-medium text-fg">{storedTotal.toLocaleString()}</strong> events.
        </p>
      ) : null}

      {imported.map((outcome) => (
        <Card key={outcome.importId} className="rise">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <p className="flex items-center gap-2 text-sm font-medium">
                <CheckCircle2 className="size-4 text-positive" aria-hidden />
                {outcome.filename}
              </p>
              <p className="mt-1 text-sm text-muted">{MATCH_COPY[outcome.matchKind]}</p>
            </div>
            <Badge tone={outcome.matchKind === "inferred" ? "accent" : "neutral"}>
              {outcome.spec?.provider ?? "Unknown"}
            </Badge>
          </div>

          <dl className="mt-4 grid grid-cols-2 gap-4 text-sm sm:grid-cols-4">
            <Figure label="Records read" value={outcome.stats.recordsRead.toLocaleString()} />
            <Figure label="Events stored" value={outcome.stats.eventsStored.toLocaleString()} />
            <Figure label="Metrics" value={String(outcome.spec?.emit.length ?? 0)} />
            <Figure
              label="Covering"
              value={
                outcome.stats.dateRange
                  ? `${outcome.stats.dateRange.from} → ${outcome.stats.dateRange.to}`
                  : "—"
              }
            />
          </dl>

          {outcome.stats.errors.length > 0 ? (
            <p className="mt-3 text-xs text-muted">
              {outcome.stats.skipped.toLocaleString()} rows skipped. First problem:{" "}
              {outcome.stats.errors[0].message}
            </p>
          ) : null}

          {outcome.specId ? (
            <Link
              href={`/conversions/${outcome.specId}`}
              className="mt-4 inline-block text-sm font-medium text-accent hover:underline"
            >
              See how this file was converted →
            </Link>
          ) : null}
        </Card>
      ))}

      {/* Exports are mostly bookkeeping. Account for it, but quietly. */}
      {skipped.length > 0 ? (
        <Card>
          <p className="text-sm font-medium">
            {skipped.length} file{skipped.length === 1 ? "" : "s"} recognised and not imported
          </p>
          <p className="mt-1 text-sm text-muted">
            Either bookkeeping with no measurements in it, or numbers already imported from a
            better source in the same export.
          </p>
          <ul className="mt-3 space-y-1.5 text-xs text-muted">
            {skipped.map((outcome) => (
              <li key={outcome.importId}>
                <span className="font-medium text-fg">{outcome.filename}</span> — {outcome.skipReason}
              </li>
            ))}
          </ul>
        </Card>
      ) : null}

      {failures.length > 0 ? (
        <Card className="border-danger/30 bg-danger/5">
          <p className="text-sm font-medium text-danger">
            {failures.length} file{failures.length === 1 ? "" : "s"} could not be read
          </p>
          <ul className="mt-2 space-y-1 text-xs text-muted">
            {failures.map((failure) => (
              <li key={failure.filename}>
                <span className="font-medium text-fg">{failure.filename}</span> — {failure.error}
              </li>
            ))}
          </ul>
        </Card>
      ) : null}
    </div>
  );
}

function Figure({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-xs uppercase tracking-wide text-subtle">{label}</dt>
      <dd className="tnum mt-0.5 font-medium">{value}</dd>
    </div>
  );
}
