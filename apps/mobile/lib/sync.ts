import { Platform } from "react-native";
import * as BackgroundTask from "expo-background-task";
import * as TaskManager from "expo-task-manager";
import { syncAllSources } from "@youai/core/adapters/sync";
import { getSetting } from "@youai/core/settings";
import { openDatabase } from "./database";
import { refreshAiConfig } from "./ai";
import { notifyDataChanged } from "./data-events";

/**
 * Replaces the server's nightly cron: live sources are refreshed on app open,
 * on pull-to-refresh, and by the OS in the background (at most every few
 * hours, when it sees fit). Spotify only exposes the last 50 plays, so the
 * more often this runs the less listening history is missed.
 */

const TASK = "youai-sync";

export async function syncNow() {
  await openDatabase();
  await refreshAiConfig();
  const results = await syncAllSources(await getSetting("timezone"));
  notifyDataChanged();
  return results;
}

// Task definitions must run at module load, outside any component.
if (Platform.OS !== "web") {
  TaskManager.defineTask(TASK, async () => {
    try {
      await syncNow();
      return BackgroundTask.BackgroundTaskResult.Success;
    } catch {
      return BackgroundTask.BackgroundTaskResult.Failed;
    }
  });
}

export async function registerBackgroundSync(): Promise<void> {
  if (Platform.OS === "web") return;
  const status = await BackgroundTask.getStatusAsync();
  if (status !== BackgroundTask.BackgroundTaskStatus.Available) return;
  if (!(await TaskManager.isTaskRegisteredAsync(TASK))) {
    await BackgroundTask.registerTaskAsync(TASK, { minimumInterval: 60 * 6 });
  }
}
