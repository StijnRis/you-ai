import { Text, View } from "react-native";
import { Stack, useLocalSearchParams } from "expo-router";
import { getMappingSpec, getSpecFingerprints } from "@youai/core/db/queries";
import { Badge, EmptyState, Loading, SectionHeading } from "@youai/ui";
import { Screen } from "../../components/screen";
import { SpecView } from "../../components/spec-view";
import { useQuery } from "../../lib/use-query";

export default function ConversionScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { data, loading } = useQuery(async () => {
    const row = await getMappingSpec(id);
    return row ? { row, fingerprints: await getSpecFingerprints(row.id) } : null;
  }, [id]);

  if (loading && !data) return <Loading />;
  if (!data) {
    return (
      <Screen>
        <EmptyState title="Conversion not found" description="It may have been removed." />
      </Screen>
    );
  }
  const { row, fingerprints } = data;

  return (
    <Screen>
      <Stack.Screen options={{ title: row.name }} />
      <SectionHeading
        title={row.name}
        description={row.spec.description}
        action={
          <View className="items-end gap-1">
            <Badge>{row.provider}</Badge>
            <Badge tone={row.origin === "inferred" ? "accent" : "neutral"}>{row.origin}</Badge>
          </View>
        }
      />
      <Text className="text-xs text-subtle">
        Used {row.timesUsed}×.{" "}
        {fingerprints.length === 0
          ? "No file shapes recorded yet — it is matched by scoring until one is."
          : `Recognises ${fingerprints.length} file ${fingerprints.length === 1 ? "shape" : "shapes"}: ${fingerprints.map((f) => f.fingerprint.slice(0, 12)).join(", ")}`}
      </Text>
      <SpecView spec={row.spec} />
    </Screen>
  );
}
