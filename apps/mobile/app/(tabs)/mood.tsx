import { useState, type ReactNode } from "react";
import { Platform, Pressable, Switch, Text, TextInput, View } from "react-native";
import { localDateOf } from "@youai/core/events/time";
import { getMoodStats, type TopDay } from "@youai/core/mood/stats";
import { logMood, recentMoodEntries } from "@youai/core/mood/log";
import { MOOD_SCALE, moodFace } from "@youai/core/mood/types";
import { getSetting, getSettings, setSetting } from "@youai/core/settings";
import { Badge, Button, Card, cn, EmptyState, ErrorText, Loading, SectionHeading, Stat } from "@youai/ui";
import { Screen } from "../../components/screen";
import { useQuery } from "../../lib/use-query";
import { notifyDataChanged } from "../../lib/data-events";
import { scheduleMoodReminder } from "../../lib/notifications";

async function loadMood() {
  const settings = await getSettings();
  const today = localDateOf(new Date(), settings.timezone);
  const [stats, recent] = await Promise.all([getMoodStats(today), recentMoodEntries(8)]);
  return { stats, recent, today, timezone: settings.timezone, reminderHour: settings.moodReminderHour };
}

export default function MoodScreen() {
  const { data, loading } = useQuery(loadMood);
  if (loading && !data) return <Loading />;
  if (!data) return null;
  const { stats, recent, today, timezone } = data;
  const face = stats.latest ? moodFace(stats.latest.value) : null;

  return (
    <Screen tab>
      <View>
        <SectionHeading
          title="How are you today?"
          description="One tap. Logged by hand or pulled from the mood connector, it all lands on the same series — so mood can be correlated against everything else you track."
        />
        <Card>
          <MoodLogger />
        </Card>
      </View>

      {stats.days === 0 ? (
        <EmptyState
          title="No mood data yet"
          description="Log your first check-in above, or connect the Fake mood feed source to backfill a year of simulated history and see the stats fill in."
        />
      ) : (
        <>
          <View>
            <SectionHeading title="Where you are" />
            <Card className="flex-row flex-wrap gap-6">
              <Stat
                label="Latest"
                value={`${face!.emoji} ${stats.latest!.value.toFixed(1)}`}
                hint={stats.latest!.localDate === today ? "today" : stats.latest!.localDate}
              />
              <Stat label="All-time" value={stats.average!.toFixed(1)} hint={`over ${stats.days} ${stats.days === 1 ? "day" : "days"}`} />
              <Stat
                label="This week"
                value={stats.trend ? stats.trend.recent.toFixed(1) : "—"}
                hint={
                  stats.trend
                    ? `${stats.trend.delta >= 0 ? "+" : "−"}${Math.abs(stats.trend.delta).toFixed(1)} on last week`
                    : "needs a few more days"
                }
              />
              <Stat
                label="Streak"
                value={stats.streak > 0 ? `${stats.streak}🔥` : "—"}
                hint={stats.streak === 1 ? "day logged" : "days in a row"}
              />
            </Card>
          </View>

          {stats.facts.length > 0 ? (
            <View>
              <SectionHeading
                title="Did you know?"
                description="Patterns found in your own data. Only shown when the gap is big enough to mean something."
              />
              <View className="gap-3">
                {stats.facts.map((fact) => (
                  <Card key={fact.headline}>
                    <Text className="font-medium text-text">💡 {fact.headline}</Text>
                    <Text className="mt-1.5 text-sm text-muted">{fact.detail}</Text>
                  </Card>
                ))}
              </View>
            </View>
          ) : null}

          <View>
            <SectionHeading title="Your top days" description="Best and worst on record, by that day's average." />
            <View className="gap-3 sm:flex-row">
              <Card className="sm:flex-1">
                <Label>🏆 Best</Label>
                <Leaderboard days={stats.best} />
              </Card>
              <Card className="sm:flex-1">
                <Label>🌧️ Toughest</Label>
                <Leaderboard days={stats.worst} />
              </Card>
            </View>
          </View>
        </>
      )}

      {recent.length > 0 ? (
        <View>
          <SectionHeading title="Recent check-ins" />
          <View className="gap-2">
            {recent.map((entry) => (
              <Card key={entry.id} className="flex-row items-center justify-between gap-3 py-3">
                <View className="flex-1 flex-row items-center gap-3">
                  <Text className="text-xl">{moodFace(entry.value).emoji}</Text>
                  <View className="flex-1">
                    <Text className="font-medium text-text">{entry.value.toFixed(1)}</Text>
                    {entry.note ? <Text className="text-sm text-muted">{entry.note}</Text> : null}
                  </View>
                </View>
                <View className="items-end gap-1">
                  <Badge tone={entry.manual ? "accent" : "neutral"}>{entry.manual ? "logged" : "synced"}</Badge>
                  <Text className="text-xs text-muted">
                    {entry.startedAt.toLocaleString(undefined, { timeZone: timezone, dateStyle: "medium", timeStyle: "short" })}
                  </Text>
                </View>
              </Card>
            ))}
          </View>
        </View>
      ) : null}

      <View>
        <SectionHeading
          title="Daily reminder"
          description="A notification on this device at the hour you pick, so the check-in becomes a habit."
        />
        <Card>
          <ReminderSettings initialHour={data.reminderHour} />
        </Card>
      </View>
    </Screen>
  );
}

function Label({ children }: { children: ReactNode }) {
  return <Text className="mb-3 text-xs font-medium uppercase tracking-wide text-subtle">{children}</Text>;
}

/**
 * The check-in itself: pick a face, optionally say why, save. Ten buttons rather
 * than a slider — nobody has slider precision about their own mood.
 */
function MoodLogger() {
  const [value, setValue] = useState<number | null>(null);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save() {
    if (value === null) return;
    setBusy(true);
    setError(null);
    try {
      await logMood({ timezone: await getSetting("timezone"), value, note: note.trim() || null });
      setNote("");
      setSaved(true);
      notifyDataChanged();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(false);
    }
  }

  return (
    <View className="gap-4">
      <View className="flex-row flex-wrap gap-1.5">
        {MOOD_SCALE.map((entry) => (
          <Pressable
            key={entry.value}
            accessibilityLabel={`${entry.value} — ${entry.label}`}
            onPress={() => {
              setValue(entry.value);
              setSaved(false);
            }}
            className={cn(
              "size-12 items-center justify-center rounded-xl border",
              value === entry.value ? "border-text bg-surface-2" : "border-border",
            )}
          >
            <Text className="text-xl">{entry.emoji}</Text>
            <Text className="text-[10px] font-medium text-muted">{entry.value}</Text>
          </Pressable>
        ))}
      </View>
      <TextInput
        value={note}
        onChangeText={setNote}
        maxLength={280}
        placeholder="What is behind it? Slept badly, good run, shipped the thing…"
        placeholderTextColor="#a8a29e"
        className="rounded-lg border border-border bg-surface px-3 py-2 text-sm text-text"
      />
      <Button onPress={save} disabled={value === null} busy={busy} className="self-start">
        {saved && !busy ? "✓ Logged" : "Log mood"}
      </Button>
      <ErrorText>{error}</ErrorText>
      <Text className="text-xs text-muted">Check in as often as you like — the day’s readings average into one number.</Text>
    </View>
  );
}

function ReminderSettings({ initialHour }: { initialHour: number | null }) {
  const [hour, setHour] = useState<number | null>(initialHour);

  async function update(next: number | null) {
    setHour(next);
    await setSetting("moodReminderHour", next);
    await scheduleMoodReminder(next);
  }

  if (Platform.OS === "web") {
    return <Text className="text-sm text-muted">Reminders work in the Android and iOS apps.</Text>;
  }

  return (
    <View className="gap-3">
      <View className="flex-row items-center gap-3">
        <Switch value={hour !== null} onValueChange={(on) => void update(on ? 20 : null)} />
        <Text className="text-sm text-text">Remind me every day</Text>
      </View>
      {hour !== null ? (
        <View className="flex-row items-center gap-2">
          <Text className="text-sm text-muted">at</Text>
          <Pressable className="rounded-lg border border-border px-3 py-1" onPress={() => void update((hour + 23) % 24)}>
            <Text className="text-text">−</Text>
          </Pressable>
          <Text className="w-14 text-center text-sm font-medium text-text">{String(hour).padStart(2, "0")}:00</Text>
          <Pressable className="rounded-lg border border-border px-3 py-1" onPress={() => void update((hour + 1) % 24)}>
            <Text className="text-text">+</Text>
          </Pressable>
        </View>
      ) : null}
    </View>
  );
}

function Leaderboard({ days }: { days: TopDay[] }) {
  if (days.length === 0) return <Text className="text-sm text-muted">Not enough data yet.</Text>;
  return (
    <View className="gap-2">
      {days.map((day, index) => (
        <View key={day.localDate} className="flex-row items-center justify-between gap-3">
          <Text className="text-sm text-text">
            <Text className="text-subtle">{index + 1} </Text>
            {moodFace(day.value).emoji}{" "}
            {new Date(`${day.localDate}T12:00:00Z`).toLocaleDateString(undefined, {
              timeZone: "UTC",
              weekday: "short",
              day: "numeric",
              month: "short",
            })}
          </Text>
          <Text className="font-medium text-text">{day.value.toFixed(1)}</Text>
        </View>
      ))}
    </View>
  );
}
