import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { requireUser } from "@/lib/auth";
import { getMappingSpec, getSpecFingerprints } from "@/lib/db/queries";
import { Badge, SectionHeading } from "@/components/ui";
import { SpecView } from "@/components/spec-view";

export default async function ConversionPage(props: PageProps<"/conversions/[id]">) {
  const user = await requireUser();
  const { id } = await props.params;
  const row = await getMappingSpec(user.id, id);

  if (!row) notFound();

  const fingerprints = await getSpecFingerprints(row.id);

  return (
    <>
      <Link
        href="/conversions"
        className="mb-5 inline-flex items-center gap-1.5 text-sm text-muted hover:text-text"
      >
        <ArrowLeft className="size-3.5" aria-hidden />
        All conversions
      </Link>

      <SectionHeading
        title={row.name}
        description={row.spec.description}
        action={
          <div className="flex items-center gap-2">
            <Badge tone="neutral">{row.provider}</Badge>
            <Badge tone={row.origin === "inferred" ? "accent" : "neutral"}>{row.origin}</Badge>
          </div>
        }
      />

      <p className="mb-6 text-xs text-subtle">
        Used {row.timesUsed}×.{" "}
        {fingerprints.length === 0 ? (
          "No file shapes recorded yet — it is matched by scoring until one is."
        ) : (
          <>
            Recognises {fingerprints.length} file{" "}
            {fingerprints.length === 1 ? "shape" : "shapes"}:{" "}
            <span className="font-mono">
              {fingerprints.map((row) => row.fingerprint.slice(0, 12)).join(", ")}
            </span>
          </>
        )}
      </p>

      <SpecView spec={row.spec} />
    </>
  );
}
