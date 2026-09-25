import { useState } from "react";
import { Pressable, Text, View } from "react-native";
import { Stack } from "expo-router";
import { apiAdapters } from "@youai/core/adapters/index";
import { listSources } from "@youai/core/db/queries";
import { Badge, Card, Loading, SectionHeading } from "@youai/ui";
import { Screen } from "../components/screen";
import {
  DisconnectButton,
  GitHubConnect,
  SimpleConnect,
  SpotifyConnect,
  SyncButton,
  WeatherConnect,
} from "../components/source-connect";
import { useQuery } from "../lib/use-query";

type WeatherPlace = { latitude?: number; longitude?: number; placeName?: string };

export default function SourcesScreen() {
  const { data: rows, loading } = useQuery(listSources);
  if (loading && !rows) return <Loading />;
  const apiSources = (rows ?? []).filter((row) => row.kind === "api");
  const importSources = (rows ?? []).filter((row) => row.kind === "import");

  return (
    <Screen>
      <Stack.Screen options={{ title: "Sources" }} />
      <View>
        <SectionHeading
          title="Sources"
          description="Two kinds of adapter feed the same on-device store: ones that pull from a service directly, and ones fed by a data export. Live sources re-sync when you open the app."
        />
        <View className="gap-3">
          {Object.values(apiAdapters).map((adapter) => {
            const connected = apiSources.filter((row) => row.provider === adapter.provider);
            const first = connected[0];
            // Calendars can be added more than once — work, personal, shared.
            const showConnect = !first || adapter.multiple;
            return (
              <Card key={adapter.provider}>
                <View className="flex-row items-start justify-between gap-4">
                  <View className="flex-1">
                    <Text className="font-medium text-text">{adapter.multiple ? adapter.label : (first?.label ?? adapter.label)}</Text>
                    <Text className="mt-1 text-sm text-muted">{adapter.description}</Text>
                    <Text className="mt-2 text-xs text-muted">
                      Produces {Object.values(adapter.types).map((type) => type.label.toLowerCase()).join(", ")}.
                    </Text>
                  </View>
                  <Badge tone={first ? "positive" : "neutral"}>
                    {connected.length > 1 ? `${connected.length} connected` : first ? "connected" : "direct API"}
                  </Badge>
                </View>

                {connected.map((source) => (
                  <View key={source.id} className="mt-4 gap-3 border-t border-border pt-4">
                    {adapter.multiple ? <Text className="text-sm font-medium text-text">{source.label}</Text> : null}
                    {adapter.provider === "open-meteo" ? (
                      <Text className="text-sm text-text">📍 {weatherPlace(source.config)}</Text>
                    ) : null}
                    <Text className="text-xs text-muted">
                      {source.eventCount.toLocaleString()} records ·{" "}
                      {source.lastSyncAt ? `last synced ${source.lastSyncAt.toLocaleString()}` : "never synced"}
                    </Text>
                    {source.lastSyncError ? <Text className="text-xs text-danger">{source.lastSyncError}</Text> : null}
                    <View className="flex-row flex-wrap gap-2">
                      <SyncButton sourceId={source.id} />
                      <DisconnectButton sourceId={source.id} label={source.label ?? adapter.label} removesData={adapter.provider === "demo"} />
                    </View>
                    {adapter.provider === "open-meteo" ? (
                      <Collapsible title="Change location">
                        <WeatherConnect existing={{ sourceId: source.id, ...(source.config as WeatherPlace) }} />
                      </Collapsible>
                    ) : null}
                  </View>
                ))}

                {showConnect ? (
                  <View className="mt-4 border-t border-border pt-4">
                    <ConnectFor provider={adapter.provider} hasOne={Boolean(first)} />
                  </View>
                ) : null}
              </Card>
            );
          })}
        </View>
      </View>

      {importSources.length > 0 ? (
        <View>
          <SectionHeading title="From imports" description="Created automatically the first time a file from that service was converted." />
          <View className="gap-2">
            {importSources.map((source) => (
              <Card key={source.id} className="flex-row items-center justify-between gap-3">
                <View>
                  <Text className="font-medium text-text">{source.label}</Text>
                  <Text className="mt-0.5 text-xs text-muted">{source.eventCount.toLocaleString()} records imported</Text>
                </View>
                <Badge>data dump</Badge>
              </Card>
            ))}
          </View>
        </View>
      ) : null}
    </Screen>
  );
}

function ConnectFor({ provider, hasOne }: { provider: string; hasOne: boolean }) {
  switch (provider) {
    case "open-meteo":
      return <WeatherConnect />;
    case "demo":
      return <SimpleConnect provider="demo" label="Sample data" fields={[]} hint="Adds a year of made-up data. Disconnect removes it again." />;
    case "mood-tracker":
      return (
        <SimpleConnect
          provider="mood-tracker"
          label="Fake mood feed"
          fields={[]}
          hint="Backfills a year of simulated check-ins. Your own logs from the Mood screen sit on the same series."
        />
      );
    case "spotify":
      return <SpotifyConnect />;
    case "github":
      return (
        <View className="gap-3">
          <GitHubConnect />
          <Collapsible title="Use a personal access token instead">
            <SimpleConnect
              provider="github"
              label="GitHub"
              fields={[
                { key: "username", label: "Username", placeholder: "octocat" },
                { key: "token", label: "Token", placeholder: "ghp_…", secret: true },
              ]}
              hint="Create a classic token with no scopes at github.com/settings/tokens."
            />
          </Collapsible>
        </View>
      );
    default:
      return (
        <SimpleConnect
          provider="google-calendar"
          label="Google Calendar"
          fields={[
            { key: "name", label: "Name", placeholder: "Work", optional: true },
            { key: "icalUrl", label: "Secret iCal address", placeholder: "https://calendar.google.com/calendar/ical/…/basic.ics", secret: true },
          ]}
          hint={`${hasOne ? "Add another calendar. " : ""}In Google Calendar: Settings → your calendar → Integrate calendar → Secret address in iCal format. Any .ics link works (Outlook, Apple).`}
        />
      );
  }
}

function Collapsible({ title, children }: { title: string; children: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  return (
    <View className="gap-3">
      <Pressable onPress={() => setOpen(!open)}>
        <Text className="text-xs text-muted">{open ? "▾" : "▸"} {title}</Text>
      </Pressable>
      {open ? children : null}
    </View>
  );
}

function weatherPlace(config: unknown): string {
  const { latitude, longitude, placeName } = (config ?? {}) as WeatherPlace;
  const coords =
    typeof latitude === "number" && typeof longitude === "number" ? `${latitude.toFixed(4)}, ${longitude.toFixed(4)}` : "No coordinates";
  return placeName ? `${placeName} (${coords})` : coords;
}
