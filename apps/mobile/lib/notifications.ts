import { Platform } from "react-native";
import * as Notifications from "expo-notifications";

/**
 * The daily mood check-in. The old app emailed it; now it is a local
 * notification scheduled on the device, no server involved. Web is skipped:
 * browsers cannot schedule notifications without a push server.
 */

const MOOD_ID = "youai-mood-reminder";

if (Platform.OS !== "web") {
  Notifications.setNotificationHandler({
    handleNotification: async () => ({
      shouldShowBanner: true,
      shouldShowList: true,
      shouldPlaySound: false,
      shouldSetBadge: false,
    }),
  });
}

/** Schedule (or cancel, with null) the daily reminder at `hour` local time. */
export async function scheduleMoodReminder(hour: number | null): Promise<void> {
  if (Platform.OS === "web") return;
  await Notifications.cancelScheduledNotificationAsync(MOOD_ID).catch(() => undefined);
  if (hour === null) return;

  const { granted } = await Notifications.requestPermissionsAsync();
  if (!granted) return;

  await Notifications.scheduleNotificationAsync({
    identifier: MOOD_ID,
    content: {
      title: "How are you today?",
      body: "Log your mood — it takes five seconds and makes every insight better.",
      data: { url: "/mood" },
    },
    trigger: { type: Notifications.SchedulableTriggerInputTypes.DAILY, hour, minute: 0 },
  });
}

/** Where a tapped notification wants to go, e.g. "/mood". */
export function notificationUrl(response: Notifications.NotificationResponse | null): string | null {
  const url = response?.notification.request.content.data?.url;
  return typeof url === "string" ? url : null;
}

/**
 * The URL of the notification the user last tapped, or null. On web the native
 * API does not exist; Platform.OS never changes at runtime, so skipping the
 * hook there does not break the rules of hooks.
 */
export function useTappedNotificationUrl(): string | null {
  // eslint-disable-next-line react-hooks/rules-of-hooks
  const response = Platform.OS === "web" ? null : Notifications.useLastNotificationResponse();
  return notificationUrl(response ?? null);
}
