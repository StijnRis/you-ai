import { useState, type ReactNode } from "react";
import { Pressable, ScrollView, Text, View } from "react-native";
import type { FieldSpec, MappingSpec, Transform } from "@youai/core/mapping/spec";
import { Badge, Card } from "@youai/ui";

/**
 * A conversion, rendered for a person rather than dumped as JSON: the source
 * field, every transform in order, and the resulting metric, as one pipeline
 * per output. A spec nobody can read is no better than eval().
 */
export function SpecView({ spec }: { spec: MappingSpec }) {
  const [showJson, setShowJson] = useState(false);
  return (
    <View className="gap-6">
      <Card>
        <Heading>Reading the file</Heading>
        <Row>
          <Badge>{spec.reader.format.toUpperCase()}</Badge>
          {spec.reader.format === "csv" ? (
            <>
              <Muted>delimiter</Muted>
              <Code>{spec.reader.delimiter === "\t" ? "\\t" : spec.reader.delimiter}</Code>
              {spec.reader.skipLines > 0 ? <Muted>· skipping {spec.reader.skipLines} lines</Muted> : null}
            </>
          ) : null}
          {"recordsPath" in spec.reader && spec.reader.recordsPath ? (
            <>
              <Muted>records at</Muted>
              <Code>{spec.reader.recordsPath}</Code>
            </>
          ) : null}
        </Row>

        <View className="mt-5">
          <Heading>When each record happened</Heading>
        </View>
        <Row>
          <FieldChip field={spec.timestamp} />
          <Muted>read as</Muted>
          <Badge>{spec.timestamp.format}</Badge>
          <Muted>in {spec.timezone === "local" ? "your local time" : "UTC"}</Muted>
        </Row>
        {spec.zoneOffset ? (
          <Row>
            <Muted>Which day an event counts towards comes from</Muted>
            <FieldChip field={spec.zoneOffset} />
            <Muted>on the record itself, so travel is dated where it happened.</Muted>
          </Row>
        ) : null}
      </Card>

      <View>
        <Heading>
          Producing {spec.emit.length} {spec.emit.length === 1 ? "metric" : "metrics"}
        </Heading>
        <View className="gap-2">
          {spec.emit.map((emit, index) => (
            <Card key={`${emit.type}-${index}`} className="gap-3">
              <Row>
                <Code accent>{emit.type}</Code>
                {emit.typeMeta ? <Text className="text-sm font-medium text-text">{emit.typeMeta.label}</Text> : null}
                {emit.typeMeta?.unit ? <Muted>({emit.typeMeta.unit})</Muted> : null}
              </Row>
              {emit.typeMeta ? (
                <Row>
                  <Badge>{emit.typeMeta.aggregation} per day</Badge>
                  {emit.typeMeta.polarity !== 0 ? (
                    <Badge tone={emit.typeMeta.polarity > 0 ? "positive" : "negative"}>
                      {emit.typeMeta.polarity > 0 ? "more is better" : "less is better"}
                    </Badge>
                  ) : null}
                </Row>
              ) : null}
              {emit.where ? (
                <Text className="text-xs text-muted">
                  Only rows where <Text className="font-mono">{emit.where.path}</Text>{" "}
                  {emit.where.equals !== undefined
                    ? `is ${String(emit.where.equals)}`
                    : emit.where.in
                      ? `is one of ${emit.where.in.join(", ")}`
                      : `contains "${emit.where.contains}"`}
                </Text>
              ) : null}
              <View className="gap-2">
                {emit.value ? <Pipeline label="value" field={emit.value} /> : null}
                {emit.valueText ? <Pipeline label="label" field={emit.valueText} /> : null}
                {emit.duration ? <Pipeline label="duration" field={emit.duration} /> : null}
                {emit.externalId ? <Pipeline label="id" field={emit.externalId} /> : null}
              </View>
              {emit.skipWhen ? (
                <Text className="text-xs text-muted">
                  Skipped when <Text className="font-mono">{emit.skipWhen.path}</Text> is {describeSkip(emit.skipWhen.is)}.
                </Text>
              ) : null}
            </Card>
          ))}
        </View>
      </View>

      <Card className="p-0">
        <Pressable className="px-4 py-3" onPress={() => setShowJson(!showJson)}>
          <Text className="text-sm font-medium text-text">{showJson ? "▾" : "▸"} The conversion as stored</Text>
        </Pressable>
        {showJson ? (
          <ScrollView horizontal className="border-t border-border px-4 py-3">
            <Text className="font-mono text-xs text-muted">{JSON.stringify(spec, null, 2)}</Text>
          </ScrollView>
        ) : null}
      </Card>
    </View>
  );
}

function Heading({ children }: { children: ReactNode }) {
  return <Text className="mb-3 text-xs font-medium uppercase tracking-wide text-subtle">{children}</Text>;
}

function Row({ children }: { children: ReactNode }) {
  return <View className="mt-1 flex-row flex-wrap items-center gap-2">{children}</View>;
}

function Muted({ children }: { children: ReactNode }) {
  return <Text className="text-sm text-muted">{children}</Text>;
}

function Code({ children, accent }: { children: ReactNode; accent?: boolean }) {
  return (
    <View className={accent ? "rounded bg-accent-soft px-1.5 py-0.5" : "rounded bg-surface-2 px-1.5 py-0.5"}>
      <Text className={accent ? "font-mono text-xs text-accent" : "font-mono text-xs text-text"}>{children}</Text>
    </View>
  );
}

/** field → transform → transform → result, as one readable row. */
function Pipeline({ label, field }: { label: string; field: FieldSpec }) {
  return (
    <View className="flex-row flex-wrap items-center gap-1.5">
      <Text className="w-14 text-xs text-subtle">{label}</Text>
      <FieldChip field={field} />
      {(field.transforms ?? []).map((transform, index) => (
        <View key={index} className="flex-row items-center gap-1.5">
          <Text className="text-xs text-subtle">→</Text>
          <Code>{describeTransform(transform)}</Code>
        </View>
      ))}
    </View>
  );
}

function FieldChip({ field }: { field: FieldSpec }) {
  if (field.derived) {
    return <Code>{field.derived === "duration_min" ? "length of the event, in minutes" : "length of the event, in seconds"}</Code>;
  }
  if (field.const !== undefined) return <Code>constant {JSON.stringify(field.const)}</Code>;
  return (
    <View className="rounded border border-border px-1.5 py-0.5">
      <Text className="font-mono text-xs text-text">{field.path ?? field.coalesce?.join(" or ") ?? "—"}</Text>
    </View>
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
      return `lookup (${transform.table.length} entries)`;
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
