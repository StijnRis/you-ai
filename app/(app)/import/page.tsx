import Link from "next/link";
import { requireUser } from "@/lib/auth";
import { listImports } from "@/lib/db/queries";
import { builtinSpecs } from "@/lib/mapping/builtin";
import { Badge, Card, SectionHeading } from "@/components/ui";
import { Uploader } from "@/components/uploader";
import { formatBytes } from "@/lib/utils";

export default async function ImportPage() {
  const user = await requireUser();
  const history = await listImports(user.id, 25);

  return (
    <div className="space-y-10">
      <section>
        <SectionHeading
          title="Import"
          description="Drop in an export from any service. The format is detected, matched against a conversion we already have, and only sent to the model when it is genuinely new."
        />
        <Uploader />
      </section>

      <section>
        <SectionHeading
          title="How detection works"
          description="Three steps, cheapest first."
        />
        <div className="grid gap-3 sm:grid-cols-3">
          <Step
            n={1}
            title="Fingerprint"
            body="The file's format and its field names are hashed. If that hash has been seen before, the conversion stored against it is reused — no model call, no cost."
          />
          <Step
            n={2}
            title="Built-ins"
            body={`Otherwise, ${builtinSpecs.length} hand-checked conversions are scored against the file's fields and filename, and the best fit wins.`}
          />
          <Step
            n={3}
            title="Infer"
            body="Only if nothing fits does the model write a new conversion — as JSON, never code. It is dry-run against real rows, then saved under the fingerprint for next time."
          />
        </div>
      </section>

      <section>
        <SectionHeading
          title="Recent imports"
          action={
            <Link href="/conversions" className="text-sm font-medium text-accent hover:underline">
              All conversions →
            </Link>
          }
        />
        {history.length === 0 ? (
          <Card>
            <p className="py-6 text-center text-sm text-muted">Nothing imported yet.</p>
          </Card>
        ) : (
          <div className="space-y-2">
            {history.map((row) => {
              const stats = row.stats as
                | { eventsStored?: number; recordsRead?: number; dateRange?: { from: string; to: string } | null }
                | null;
              return (
                <Card key={row.id} className="flex flex-wrap items-center gap-x-4 gap-y-2">
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-mono text-sm">{row.filename}</p>
                    <p className="mt-0.5 text-xs text-muted">
                      {formatBytes(row.byteSize)}
                      {stats?.recordsRead ? ` · ${stats.recordsRead.toLocaleString()} records` : ""}
                      {stats?.eventsStored ? ` · ${stats.eventsStored.toLocaleString()} events` : ""}
                      {stats?.dateRange ? ` · ${stats.dateRange.from} – ${stats.dateRange.to}` : ""}
                    </p>
                    {row.error ? (
                      <p className="mt-1 text-xs text-danger">{row.error}</p>
                    ) : null}
                  </div>

                  {row.matchKind ? (
                    <Badge tone={row.matchKind === "inferred" ? "accent" : "neutral"}>
                      {row.matchKind === "fingerprint"
                        ? "reused"
                        : row.matchKind === "builtin"
                          ? "built-in"
                          : "inferred"}
                    </Badge>
                  ) : null}

                  {row.specId ? (
                    <Link
                      href={`/conversions/${row.specId}`}
                      className="text-sm text-accent hover:underline"
                    >
                      {row.specName}
                    </Link>
                  ) : null}

                  <Badge tone={row.status === "done" ? "positive" : row.status === "failed" ? "danger" : "neutral"}>
                    {row.status}
                  </Badge>
                </Card>
              );
            })}
          </div>
        )}
      </section>
    </div>
  );
}

function Step({ n, title, body }: { n: number; title: string; body: string }) {
  return (
    <Card>
      <span className="flex size-6 items-center justify-center rounded-md bg-accent-soft text-xs font-semibold text-accent">
        {n}
      </span>
      <h3 className="mt-3 text-sm font-medium">{title}</h3>
      <p className="mt-1 text-sm leading-relaxed text-muted">{body}</p>
    </Card>
  );
}
