import type { ColorValue } from "react-native";
import { Tabs } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { countAwaitingEvaluation } from "@youai/core/experiments/store";
import { getSetting } from "@youai/core/settings";
import { useQuery } from "../../lib/use-query";

type IconName = keyof typeof Ionicons.glyphMap;

const icon =
  (name: IconName) =>
  function TabIcon({ color, size }: { color: ColorValue; size: number }) {
    return <Ionicons name={name} color={color as string} size={size} />;
  };

export default function TabsLayout() {
  // A finished experiment nobody reads is a wasted week, so the count follows
  // the person around the app until they look at it.
  const { data: awaiting } = useQuery(async () => countAwaitingEvaluation(await getSetting("timezone")));

  // Each screen has its own heading, so the tab header would only repeat it.
  return (
    <Tabs screenOptions={{ headerShown: false }}>
      <Tabs.Screen name="index" options={{ title: "Dashboard", tabBarIcon: icon("grid-outline") }} />
      <Tabs.Screen name="insights" options={{ title: "Insights", tabBarIcon: icon("bar-chart-outline") }} />
      <Tabs.Screen name="chat" options={{ title: "Chat", tabBarIcon: icon("chatbubbles-outline") }} />
      <Tabs.Screen name="mood" options={{ title: "Mood", tabBarIcon: icon("happy-outline") }} />
      <Tabs.Screen
        name="more"
        options={{
          title: "More",
          tabBarIcon: icon("menu-outline"),
          tabBarBadge: awaiting ? awaiting : undefined,
        }}
      />
    </Tabs>
  );
}
