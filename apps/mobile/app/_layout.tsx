import "../lib/polyfills";
import "../global.css";

import { useEffect, useState } from "react";
import { Text, useColorScheme, View } from "react-native";
import { DarkTheme, DefaultTheme, Stack, ThemeProvider, useRouter } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { getSetting } from "@youai/core/settings";
import { Loading } from "@youai/ui";
import { openDatabase } from "../lib/database";
import { refreshAiConfig } from "../lib/ai";
import { registerBackgroundSync, syncNow } from "../lib/sync";
import { scheduleMoodReminder, useTappedNotificationUrl } from "../lib/notifications";

// Navigation chrome (headers, tab bar) in the same palette as global.css.
const LIGHT = { ...DefaultTheme, colors: { ...DefaultTheme.colors, primary: "#4338ca", background: "#fbfbfa", card: "#ffffff", border: "#e7e5e4", text: "#1c1917" } };
const DARK = { ...DarkTheme, colors: { ...DarkTheme.colors, primary: "#a5b4fc", background: "#0c0a09", card: "#171514", border: "#2b2724", text: "#f5f5f4" } };

export default function RootLayout() {
  const scheme = useColorScheme();
  const [state, setState] = useState<"loading" | "ready" | Error>("loading");
  const router = useRouter();

  useEffect(() => {
    openDatabase()
      .then(async () => {
        await refreshAiConfig();
        setState("ready");
        // Everything below is best-effort and must not block the first screen.
        void registerBackgroundSync().catch(() => undefined);
        void scheduleMoodReminder(await getSetting("moodReminderHour")).catch(() => undefined);
        void syncNow().catch(() => undefined);
      })
      .catch((error: unknown) => setState(error instanceof Error ? error : new Error(String(error))));
  }, []);

  // Tapping the mood reminder opens the mood screen.
  const tappedUrl = useTappedNotificationUrl();
  useEffect(() => {
    if (state === "ready" && tappedUrl) router.push(tappedUrl as never);
  }, [tappedUrl, state, router]);

  if (state === "loading") {
    return (
      <View className="flex-1 justify-center bg-bg">
        <Loading />
      </View>
    );
  }
  if (state instanceof Error) {
    return (
      <View className="flex-1 justify-center bg-bg p-6">
        <Text className="text-lg font-semibold text-text">Could not open the local database</Text>
        <Text className="mt-2 text-sm text-muted">{state.message}</Text>
      </View>
    );
  }

  return (
    <ThemeProvider value={scheme === "dark" ? DARK : LIGHT}>
      <StatusBar style="auto" />
      <Stack screenOptions={{ headerShadowVisible: false, headerBackTitle: "Back" }}>
        <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
      </Stack>
    </ThemeProvider>
  );
}
