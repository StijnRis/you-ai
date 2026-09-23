import Link from "next/link";
import { requireUser } from "@/lib/auth";
import { listMappingSpecs } from "@/lib/db/queries";
import { Badge, Card, EmptyState, SectionHeading } from "@/components/ui";

const ORIGIN_TONE = {
  builtin: "neutral",
  inferred: "accent",
  manual: "positive",
} as const;

export default async function ConversionsPage() {
  const user = await requireUser();
  const specs = await listMappingSpecs(user.id);

  return (
    <>
      <SectionHeading
        title="Conversions"
        description="Every format the app knows how to read, stored as data rather than code. Each one is matched to files by a fingerprint of their shape, so it is written at most once."
      />

      {specs.length === 0 ? (
        <EmptyState
          title="No conversions yet"
          description="Built-ins are registered the first time a file matches them, and new ones appear here as the model writes them."
          action={
            <Link
              href="/import"
              className="rounded-lg bg-text px-4 py-2 text-sm font-medium text-bg hover:opacity-90"
            >
              Import a file
            </Link>
          }
        />
      ) : (
        <div className="space-y-2">
          {specs.map((spec) => (
            <Link key={spec.id} href={`/conversions/${spec.id}`} className="block">
              <Card className="transition-colors hover:border-border-strong">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div className="min-w-0">
                    <p className="font-medium">{spec.name}</p>
                    <p className="mt-0.5 font-mono text-xs text-muted">{spec.key}</p>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-xs text-muted">
                      {spec.spec.emit.length} {spec.spec.emit.length === 1 ? "metric" : "metrics"}
                    </span>
                    <span className="text-xs text-muted">·</span>
                    <span className="text-xs text-muted">
                      used {spec.timesUsed}×
                    </span>
                    <Badge tone={ORIGIN_TONE[spec.origin]}>{spec.origin}</Badge>
                  </div>
                </div>
              </Card>
            </Link>
          ))}
        </div>
      )}
    </>
  );
}
