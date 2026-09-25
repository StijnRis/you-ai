import { useState } from "react";
import { ActivityIndicator, Platform, Text, View } from "react-native";
import { Link, Stack } from "expo-router";
import * as DocumentPicker from "expo-document-picker";
import { File } from "expo-file-system";
import { listImports } from "@youai/core/db/queries";
import { builtinSpecs } from "@youai/core/mapping/builtin/index";
import { runImport, type ImportOutcome } from "@youai/core/import/run";
import { getSettings } from "@youai/core/settings";
import { formatBytes } from "@youai/core/format";
import { Badge, Button, Card, SectionHeading } from "@youai/ui";
import { Screen } from "../components/screen";
import { useQuery } from "../lib/use-query";
import { notifyDataChanged } from "../lib/data-events";

const MATCH_COPY = {
  fingerprint: "Reused a conversion stored for this exact file shape.",
  builtin: "Matched a conversion that ships with the app.",
  inferred: "New format — the model wrote a conversion for it, and it has been saved.",
  skipped: "Recognised, and deliberately not imported.",
} as const;

/** Read a picked file's bytes on either platform. Nothing is uploaded anywhere. */
async function readAsset(asset: DocumentPicker.DocumentPickerAsset): Promise<Uint8Array> {
  if (Platform.OS === "web") {
    const blob = asset.file ?? (await (await fetch(asset.uri)).blob());
    return new Uint8Array(await blob.arrayBuffer());
  }
  return new Uint8Array(await new File(asset.uri).arrayBuffer());
}

export default function ImportScreen() {
  const { data: history } = useQuery(() => listImports(25));
  const [busy, setBusy] = useState(false);
  const [outcomes, setOutcomes] = useState<ImportOutcome[] | null>(null);
  const [failures, setFailures] = useState<{ filename: string; error: string }[]>([]);

  async function pick() {
    const picked = await DocumentPicker.getDocumentAsync({ multiple: true, copyToCacheDirectory: true });
    if (picked.canceled || picked.assets.length === 0) return;

    setBusy(true);
    setOutcomes(null);
    setFailures([]);
    const settings = await getSettings();
    const done: ImportOutcome[] = [];
    const failed: { filename: string; error: string }[] = [];
    for (const asset of picked.assets) {
      try {
        done.push(
          ...(await runImport({
            timezone: settings.timezone,
            filename: asset.name,
            data: await readAsset(asset),
            allowInference: settings.allowInference,
          })),
        );
      } catch (error) {
        failed.push({ filename: asset.name, error: error instanceof Error ? error.message : String(error) });
      }
    }
    setOutcomes(done);
    setFailures(failed);
    setBusy(false);
    notifyDataChanged();
  }

  const imported = (outcomes ?? []).filter((o) => o.matchKind !== "skipped");
  const skipped = (outcomes ?? []).filter((o) => o.matchKind === "skipped");
  const storedTotal = imported.reduce((sum, o) => sum + o.stats.eventsStored, 0);

  return (
    <Screen refresh={false}>
      <Stack.Screen options={{ title: "Import" }} />
      <View>
        <SectionHeading
          title="Import"
          description="Pick an export from any service. It is read on this device: the format is detected, matched against a conversion we already have, and only sent to the model when it is genuinely new."
        />
        <View className="items-center rounded-xl border border-dashed border-border-strong px-6 py-10">
          {busy ? (
            <View className="flex-row items-center gap-2">
              <ActivityIndicator size="small" />
              <Text className="text-sm text-muted">Detecting formats and converting…</Text>
            </View>
          ) : (
            <>
              <Text className="text-sm font-medium text-text">Choose a data export</Text>
              <Text className="mt-1 max-w-sm text-center text-sm text-muted">
                CSV, TSV, JSON, NDJSON, XML, or a zip of them — Apple Health, Samsung Health, Google Takeout, Strava,
                or something we have never seen. Several files at once is fine.
              </Text>
              <Button variant="secondary" className="mt-4" onPress={() => void pick()}>
                Choose files
              </Button>
            </>
          )}
        </View>
      </View>

      {imported.length > 0 ? (
        <Text className="text-sm text-muted">
          Imported <Text className="font-medium text-text">{imported.length}</Text> file{imported.length === 1 ? "" : "s"}, storing{" "}
          <Text className="font-medium text-text">{storedTotal.toLocaleString()}</Text> events.
        </Text>
      ) : null}

      {imported.map((outcome) => (
        <Card key={outcome.importId} className="gap-3">
          <View className="flex-row items-start justify-between gap-3">
            <View className="flex-1">
              <Text className="text-sm font-medium text-text">✓ {outcome.filename}</Text>
              <Text className="mt-1 text-sm text-muted">{MATCH_COPY[outcome.matchKind]}</Text>
            </View>
            <Badge tone={outcome.matchKind === "inferred" ? "accent" : "neutral"}>{outcome.spec?.provider ?? "Unknown"}</Badge>
          </View>
          <View className="flex-row flex-wrap gap-4">
            <Figure label="Records read" value={outcome.stats.recordsRead.toLocaleString()} />
            <Figure label="Events stored" value={outcome.stats.eventsStored.toLocaleString()} />
            <Figure label="Metrics" value={String(outcome.spec?.emit.length ?? 0)} />
            <Figure label="Covering" value={outcome.stats.dateRange ? `${outcome.stats.dateRange.from} → ${outcome.stats.dateRange.to}` : "—"} />
          </View>
          {outcome.stats.errors.length > 0 ? (
            <Text className="text-xs text-muted">
              {outcome.stats.skipped.toLocaleString()} rows skipped. First problem: {outcome.stats.errors[0].message}
            </Text>
          ) : null}
          {outcome.specId ? (
            <Link href={`/conversions/${outcome.specId}`}>
              <Text className="text-sm font-medium text-accent">See how this file was converted →</Text>
            </Link>
          ) : null}
        </Card>
      ))}

      {/* Exports are mostly bookkeeping. Account for it, but quietly. */}
      {skipped.length > 0 ? (
        <Card className="gap-2">
          <Text className="text-sm font-medium text-text">
            {skipped.length} file{skipped.length === 1 ? "" : "s"} recognised and not imported
          </Text>
          {skipped.map((o) => (
            <Text key={o.importId} className="text-xs text-muted">
              <Text className="font-medium text-text">{o.filename}</Text> — {o.skipReason}
            </Text>
          ))}
        </Card>
      ) : null}

      {failures.length > 0 ? (
        <Card className="gap-2 border-danger">
          <Text className="text-sm font-medium text-danger">
            {failures.length} file{failures.length === 1 ? "" : "s"} could not be read
          </Text>
          {failures.map((f) => (
            <Text key={f.filename} className="text-xs text-muted">
              <Text className="font-medium text-text">{f.filename}</Text> — {f.error}
            </Text>
          ))}
        </Card>
      ) : null}

      <View>
        <SectionHeading title="How detection works" description="Three steps, cheapest first." />
        <View className="gap-3">
          <Step n={1} title="Fingerprint" body="The file's format and its field names are hashed. If that hash has been seen before, the conversion stored against it is reused — no model call, no cost." />
          <Step n={2} title="Built-ins" body={`Otherwise, ${builtinSpecs.length} hand-checked conversions are scored against the file's fields and filename, and the best fit wins.`} />
          <Step n={3} title="Infer" body="Only if nothing fits does the model write a new conversion — as JSON, never code. It is dry-run against real rows, then saved under the fingerprint for next time." />
        </View>
      </View>

      <View>
        <SectionHeading
          title="Recent imports"
          action={
            <Link href="/conversions">
              <Text className="text-sm font-medium text-accent">All conversions →</Text>
            </Link>
          }
        />
        {!history || history.length === 0 ? (
          <Card>
            <Text className="py-6 text-center text-sm text-muted">Nothing imported yet.</Text>
          </Card>
        ) : (
          <View className="gap-2">
            {history.map((row) => {
              const stats = row.stats as { eventsStored?: number; recordsRead?: number; dateRange?: { from: string; to: string } | null } | null;
              return (
                <Card key={row.id} className="gap-2">
                  <Text className="font-mono text-sm text-text" numberOfLines={1}>{row.filename}</Text>
                  <Text className="text-xs text-muted">
                    {formatBytes(row.byteSize)}
                    {stats?.recordsRead ? ` · ${stats.recordsRead.toLocaleString()} records` : ""}
                    {stats?.eventsStored ? ` · ${stats.eventsStored.toLocaleString()} events` : ""}
                    {stats?.dateRange ? ` · ${stats.dateRange.from} – ${stats.dateRange.to}` : ""}
                  </Text>
                  {row.error ? (
                    // A skipped file stores its reason here too; that is an explanation, not a problem.
                    <Text className={row.status === "skipped" ? "text-xs text-muted" : "text-xs text-danger"}>{row.error}</Text>
                  ) : null}
                  <View className="flex-row flex-wrap items-center gap-2">
                    {row.matchKind ? (
                      <Badge tone={row.matchKind === "inferred" ? "accent" : "neutral"}>
                        {row.matchKind === "fingerprint" ? "reused" : row.matchKind === "builtin" ? "built-in" : row.matchKind === "skipped" ? "not imported" : "inferred"}
                      </Badge>
                    ) : null}
                    <Badge tone={row.status === "done" ? "positive" : row.status === "failed" ? "danger" : "neutral"}>{row.status}</Badge>
                    {row.specId ? (
                      <Link href={`/conversions/${row.specId}`}>
                        <Text className="text-sm text-accent">{row.specName}</Text>
                      </Link>
                    ) : null}
                  </View>
                </Card>
              );
            })}
          </View>
        )}
      </View>
    </Screen>
  );
}

function Step({ n, title, body }: { n: number; title: string; body: string }) {
  return (
    <Card>
      <View className="size-6 items-center justify-center rounded-md bg-accent-soft">
        <Text className="text-xs font-semibold text-accent">{n}</Text>
      </View>
      <Text className="mt-3 text-sm font-medium text-text">{title}</Text>
      <Text className="mt-1 text-sm leading-relaxed text-muted">{body}</Text>
    </Card>
  );
}

function Figure({ label, value }: { label: string; value: string }) {
  return (
    <View>
      <Text className="text-xs uppercase tracking-wide text-subtle">{label}</Text>
      <Text className="mt-0.5 text-sm font-medium text-text">{value}</Text>
    </View>
  );
}
