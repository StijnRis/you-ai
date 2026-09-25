import { Pressable, Text, View } from "react-native";
import { Link, Stack } from "expo-router";
import { listMappingSpecs } from "@youai/core/db/queries";
import { Badge, Button, Card, EmptyState, Loading, SectionHeading } from "@youai/ui";
import { Screen } from "../../components/screen";
import { useQuery } from "../../lib/use-query";

const ORIGIN_TONE = { builtin: "neutral", inferred: "accent", manual: "positive" } as const;

export default function ConversionsScreen() {
  const { data: specs, loading } = useQuery(listMappingSpecs);
  if (loading && !specs) return <Loading />;

  return (
    <Screen>
      <Stack.Screen options={{ title: "Conversions" }} />
      <SectionHeading
        title="Conversions"
        description="Every format the app knows how to read, stored as data rather than code. Each one is matched to files by a fingerprint of their shape, so it is written at most once."
      />
      {!specs || specs.length === 0 ? (
        <EmptyState
          title="No conversions yet"
          description="New ones appear here as the model writes them for unfamiliar files."
          action={
            <Link href="/import" asChild>
              <Button>Import a file</Button>
            </Link>
          }
        />
      ) : (
        <View className="gap-2">
          {specs.map((spec) => (
            <Link key={spec.id} href={`/conversions/${spec.id}`} asChild>
              <Pressable>
                <Card className="gap-2">
                  <Text className="font-medium text-text">{spec.name}</Text>
                  <Text className="font-mono text-xs text-muted">{spec.key}</Text>
                  <View className="flex-row flex-wrap items-center gap-2">
                    <Text className="text-xs text-muted">
                      {spec.spec.emit.length} {spec.spec.emit.length === 1 ? "metric" : "metrics"} · used {spec.timesUsed}×
                    </Text>
                    <Badge tone={ORIGIN_TONE[spec.origin]}>{spec.origin}</Badge>
                  </View>
                </Card>
              </Pressable>
            </Link>
          ))}
        </View>
      )}
    </Screen>
  );
}
