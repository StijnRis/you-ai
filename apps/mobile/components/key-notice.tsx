import { Text } from "react-native";
import { Link } from "expo-router";
import { isModelConfigured } from "@youai/core/ai/provider";
import { Card } from "@youai/ui";

/** Shown wherever an AI feature is about to be used without a key (BYOK). */
export function KeyNotice() {
  if (isModelConfigured()) return null;
  return (
    <Card className="border-accent bg-accent-soft">
      <Text className="text-sm text-text">
        The AI features use your own Nebius key.{" "}
        <Link href="/settings">
          <Text className="font-medium text-accent">Add it in Settings →</Text>
        </Link>
      </Text>
    </Card>
  );
}
