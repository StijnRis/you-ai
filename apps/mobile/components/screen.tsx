import { useState, type ReactNode } from "react";
import { RefreshControl, ScrollView, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { syncNow } from "../lib/sync";

/**
 * Scrollable page body with the app's padding and max width (so the web build
 * doesn't stretch across a wide monitor). Pull-to-refresh re-syncs sources.
 * Tab screens have no header, so they pass `tab` to keep clear of the notch.
 */
export function Screen({ children, refresh = true, tab = false }: { children: ReactNode; refresh?: boolean; tab?: boolean }) {
  const [refreshing, setRefreshing] = useState(false);
  const onRefresh = async () => {
    setRefreshing(true);
    await syncNow().catch(() => undefined);
    setRefreshing(false);
  };

  return (
    <SafeAreaView edges={tab ? ["top"] : []} className="flex-1 bg-bg">
      <ScrollView
        className="flex-1 bg-bg"
        contentContainerClassName="p-4 pb-12"
        keyboardShouldPersistTaps="handled"
        refreshControl={refresh ? <RefreshControl refreshing={refreshing} onRefresh={onRefresh} /> : undefined}
      >
        <View className="mx-auto w-full max-w-3xl gap-6">{children}</View>
      </ScrollView>
    </SafeAreaView>
  );
}
