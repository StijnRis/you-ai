import { ArrowRight } from "lucide-react";
import type { FieldSpec, MappingSpec, Transform } from "@/lib/mapping/spec";
import { Badge, Card } from "@/components/ui";

/**
 * A conversion, rendered for a person rather than dumped as JSON.
 *
 * The whole point of keeping conversions as data is that they can be read and
 * checked. A spec nobody can understand is no better than the eval() we refused
 * to write — so the source field, every transform in order, and the resulting
 * metric are laid out as one left-to-right pipeline per output.
 */

export function SpecView({ spec }: { spec: MappingSpec }) {
  return (
    <div className="space-y-6">
      <Card>
        <h3 className="text-xs font-medium uppercase tracking-wide text-subtle">Reading the file</h3>
        <div className="mt-3 flex flex-wrap items-center gap-2 text-sm">
          <Badge tone="neutral">{spec.reader.format.toUpperCase()}</Badge>
          {spec.reader.format === "csv" ? (
            <>
              <span className="text-muted">delimiter</span>
              <code className="rounded bg-surface-2 px-1.5 py-0.5 font-mono text-xs">
                {spec.reader.delimiter === "\t" ? "\\t" : spec.reader.delimiter}
              </code>
              {spec.reader.skipLines > 0 ? (
                <span className="text-muted">· skipping {spec.reader.skipLines} lines</span>
              ) : null}
            </>
          ) : null}
          {"recordsPath" in spec.reader && spec.reader.recordsPath ? (
            <>
              <span className="text-muted">records at</span>
              <code className="rounded bg-surface-2 px-1.5 py-0.5 font-mono text-xs">
                {spec.reader.recordsPath}
              </code>
            </>
          ) : null}
        </div>

        <h3 className="mt-5 text-xs font-medium uppercase tracking-wide text-subtle">
          When each record happened
        </h3>
        <div className="mt-2 flex flex-wrap items-center gap-2 text-sm">
          <FieldChip field={spec.timestamp} />
          <span className="text-muted">read as</span>
          <Badge tone="neutral">{spec.timestamp.format}</Badge>
          <span className="text-muted">
            in {spec.timezone === "local" ? "your local time" : "UTC"}
          </span>
        </div>
      </Card>

      <div>
        <h3 className="mb-3 text-xs font-medium uppercase tracking-wide text-subtle">
          Producing {spec.emit.length} {spec.emit.length === 1 ? "metric" : "metrics"}
        </h3>
        <div className="space-y-2">
          {spec.emit.map((emit, index) => (
            <Card key={`${emit.type}-${index}`}>
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex flex-wrap items-center gap-2">
                  <code className="rounded bg-accent-soft px-1.5 py-0.5 font-mono text-xs text-accent">
                    {emit.type}
                  </code>
                  {emit.typeMeta ? (
                    <span className="text-sm font-medium">{emit.typeMeta.label}</span>
                  ) : null}
                  {emit.typeMeta?.unit ? (
                    <span className="text-sm text-muted">({emit.typeMeta.unit})</span>
                  ) : null}
                </div>
                {emit.typeMeta ? (
                  <div className="flex gap-1.5">
                    <Badge tone="neutral">{emit.typeMeta.aggregation} per day</Badge>
                    {emit.typeMeta.polarity !== 0 ? (
                      <Badge tone={emit.typeMeta.polarity > 0 ? "positive" : "negative"}>
                        {emit.typeMeta.polarity > 0 ? "more is better" : "less is better"}
                      </Badge>
                    ) : null}
                  </div>
                ) : null}
              </div>

              {emit.where ? (
                <p className="mt-2.5 text-xs text-muted">
                  Only rows where{" "}
                  <code className="rounded bg-surface-2 px-1 py-0.5 font-mono">
                    {emit.where.path}
                  </code>{" "}
                  {emit.where.equals !== undefined
                    ? `is ${String(emit.where.equals)}`
                    : emit.where.in
                      ? `is one of ${emit.where.in.join(", ")}`
                      : `contains "${emit.where.contains}"`}
                </p>
              ) : null}

              <div className="mt-3 space-y-2">
                {emit.value ? <Pipeline label="value" field={emit.value} /> : null}
                {emit.valueText ? <Pipeline label="label" field={emit.valueText} /> : null}
                {emit.duration ? <Pipeline label="duration" field={emit.duration} /> : null}
                {emit.externalId ? <Pipeline label="id" field={emit.externalId} /> : null}
              </div>

              {emit.skipWhen ? (
                <p className="mt-2.5 text-xs text-muted">
                  Skipped when{" "}
                  <code className="rounded bg-surface-2 px-1 py-0.5 font-mono">
                    {emit.skipWhen.path}
                  </code>{" "}
                  is {describeSkip(emit.skipWhen.is)}.
                </p>
              ) : null}
            </Card>
          ))}
        </div>
      </div>

      <details className="rounded-xl border border-border bg-surface">
        <summary className="cursor-pointer select-none px-5 py-3.5 text-sm font-medium">
          The conversion as stored
        </summary>
        <pre className="overflow-x-auto border-t border-border px-5 py-4 font-mono text-xs leading-relaxed text-muted">
          {JSON.stringify(spec, null, 2)}
        </pre>
      </details>
    </div>
  );
}

/** field → transform → transform → result, as one readable row. */
function Pipeline({ label, field }: { label: string; field: FieldSpec }) {
  return (
    <div className="flex flex-wrap items-center gap-1.5 text-xs">
      <span className="w-14 shrink-0 text-subtle">{label}</span>
      <FieldChip field={field} />
      {(field.transforms ?? []).map((transform, index) => (
        <span key={index} className="flex items-center gap-1.5">
          <ArrowRight className="size-3 text-subtle" aria-hidden />
          <code className="rounded bg-surface-2 px-1.5 py-0.5 font-mono">
            {describeTransform(transform)}
          </code>
        </span>
      ))}
    </div>
  );
}

function FieldChip({ field }: { field: FieldSpec }) {
  if (field.const !== undefined) {
    return (
      <code className="rounded bg-surface-2 px-1.5 py-0.5 font-mono text-xs">
        constant {JSON.stringify(field.const)}
      </code>
    );
  }
  const path = field.path ?? field.coalesce?.join(" or ") ?? "—";
  return (
    <code className="rounded border border-border px-1.5 py-0.5 font-mono text-xs">{path}</code>
  );
}

function describeTransform(transform: Transform): string {
  switch (transform.op) {
    case "multiply":
      return `× ${transform.by}`;
    case "divide":
      return `÷ ${transform.by}`;
    case "add":
      return `+ ${transform.value}`;
    case "round":
      return `round to ${transform.decimals}dp`;
    case "clamp":
      return `clamp ${transform.min ?? "−∞"}…${transform.max ?? "∞"}`;
    case "replace":
      return `"${transform.find}" → "${transform.with}"`;
    case "extract":
      return `extract /${transform.pattern}/`;
    case "map":
      return `lookup (${Object.keys(transform.table).length} entries)`;
    case "defaultTo":
      return `default ${JSON.stringify(transform.value)}`;
    default:
      return transform.op;
  }
}

function describeSkip(is: string): string {
  switch (is) {
    case "empty":
      return "empty";
    case "zero":
      return "zero";
    case "emptyOrZero":
      return "empty or zero";
    default:
      return "not a number";
  }
}
