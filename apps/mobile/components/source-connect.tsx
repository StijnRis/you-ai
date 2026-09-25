import { useEffect, useState } from "react";
import { Alert, Platform, Pressable, Text, View } from "react-native";
import * as Location from "expo-location";
import * as WebBrowser from "expo-web-browser";
import * as Linking from "expo-linking";
import { exchangeCodeAsync, makeRedirectUri, ResponseType, useAuthRequest } from "expo-auth-session";
import { connectSource, disconnectSource, reconfigureSource, type SourceChange } from "@youai/core/adapters/manage";
import { syncSource } from "@youai/core/adapters/sync";
import { SPOTIFY_DISCOVERY, SPOTIFY_SCOPES } from "@youai/core/adapters/spotify";
import { getSetting } from "@youai/core/settings";
import { Button, ErrorText, Field } from "@youai/ui";
import { notifyDataChanged } from "../lib/data-events";

WebBrowser.maybeCompleteAuthSession();

function describe(change: SourceChange, verb: string): { message: string | null; error: string | null } {
  if (change.syncError) return { message: null, error: `${verb}, but the sync failed: ${change.syncError}` };
  return {
    message: `${verb}. Stored ${change.sync?.eventsStored.toLocaleString() ?? 0} readings across ${change.sync?.daysTouched ?? 0} days.`,
    error: null,
  };
}

function useAction() {
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  async function run(action: () => Promise<{ message: string | null; error: string | null } | void>) {
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      const result = await action();
      if (result) {
        setMessage(result.message);
        setError(result.error);
      }
      notifyDataChanged();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(false);
    }
  }
  return { busy, message, error, run };
}

/**
 * Weather needs coordinates. Asking for a latitude and longitude is hostile, so
 * the device location fills them in — but the fields stay editable, because
 * people also want the weather where they *were*.
 */
export function WeatherConnect({
  existing,
}: {
  existing?: { sourceId: string; latitude?: number; longitude?: number; placeName?: string };
}) {
  const [latitude, setLatitude] = useState(existing?.latitude?.toString() ?? "");
  const [longitude, setLongitude] = useState(existing?.longitude?.toString() ?? "");
  const [placeName, setPlaceName] = useState(existing?.placeName ?? "");
  const action = useAction();

  async function locate() {
    const { granted } = await Location.requestForegroundPermissionsAsync();
    if (!granted) return Alert.alert("Location permission denied", "Enter coordinates by hand.");
    const position = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Low });
    setLatitude(position.coords.latitude.toFixed(4));
    setLongitude(position.coords.longitude.toFixed(4));
  }

  const valid = latitude !== "" && longitude !== "" && Number.isFinite(Number(latitude)) && Number.isFinite(Number(longitude));
  const config = { latitude: Number(latitude), longitude: Number(longitude), placeName: placeName || undefined };
  const label = placeName ? `Weather — ${placeName}` : "Weather";

  return (
    <View className="gap-3">
      <View className="flex-row gap-3">
        <View className="flex-1"><Field label="Latitude" value={latitude} onChangeText={setLatitude} placeholder="40.4168" keyboardType="numbers-and-punctuation" /></View>
        <View className="flex-1"><Field label="Longitude" value={longitude} onChangeText={setLongitude} placeholder="-3.7038" keyboardType="numbers-and-punctuation" /></View>
      </View>
      <Field label="Name (optional)" value={placeName} onChangeText={setPlaceName} placeholder="Madrid" />
      <View className="flex-row flex-wrap gap-2">
        <Button variant="secondary" onPress={() => void locate()}>Use my location</Button>
        <Button
          disabled={!valid}
          busy={action.busy}
          onPress={() =>
            void action.run(async () => {
              const timezone = await getSetting("timezone");
              return existing
                ? describe(await reconfigureSource({ sourceId: existing.sourceId, config, label, timezone }), "Location updated")
                : describe(await connectSource({ provider: "open-meteo", label, config, timezone }), "Connected");
            })
          }
        >
          {existing ? "Update location" : "Connect"}
        </Button>
      </View>
      {action.message ? <Text className="text-sm text-positive">{action.message}</Text> : null}
      <ErrorText>{action.error}</ErrorText>
      <Text className="text-xs text-muted">
        {existing
          ? "Readings for the old location are replaced with a year of history for the new one."
          : "The first sync backfills a year, so there is something to correlate against immediately."}
      </Text>
    </View>
  );
}

type ConnectField = { key: string; label: string; placeholder: string; secret?: boolean; optional?: boolean };

/** Connect form for adapters whose config is just a few text fields. */
export function SimpleConnect({
  provider,
  label,
  fields,
  hint,
}: {
  provider: string;
  label: string;
  fields: ConnectField[];
  hint?: string;
}) {
  const [values, setValues] = useState<Record<string, string>>({});
  const action = useAction();
  const valid = fields.every((field) => field.optional || values[field.key]?.trim());

  return (
    <View className="gap-3">
      {fields.map((field) => (
        <Field
          key={field.key}
          label={`${field.label}${field.optional ? " (optional)" : ""}`}
          value={values[field.key] ?? ""}
          onChangeText={(text) => setValues({ ...values, [field.key]: text })}
          placeholder={field.placeholder}
          secureTextEntry={field.secret}
          autoCapitalize="none"
          autoCorrect={false}
        />
      ))}
      <Button
        className="self-start"
        disabled={!valid}
        busy={action.busy}
        onPress={() =>
          void action.run(async () => {
            const config = Object.fromEntries(Object.entries(values).filter(([, v]) => v.trim() !== ""));
            const change = await connectSource({
              provider,
              label: typeof config.name === "string" ? `${label} — ${config.name}` : label,
              config,
              timezone: await getSetting("timezone"),
            });
            setValues({});
            return describe(change, "Connected");
          })
        }
      >
        Connect
      </Button>
      {action.message ? <Text className="text-sm text-positive">{action.message}</Text> : null}
      <ErrorText>{action.error}</ErrorText>
      {hint ? <Text className="text-xs text-muted">{hint}</Text> : null}
    </View>
  );
}

export function SyncButton({ sourceId }: { sourceId: string }) {
  const action = useAction();
  return (
    <View className="items-end gap-1">
      <Button
        variant="secondary"
        busy={action.busy}
        onPress={() =>
          void action.run(async () => {
            await syncSource({ sourceId, timezone: await getSetting("timezone") });
          })
        }
      >
        Sync now
      </Button>
      <ErrorText>{action.error}</ErrorText>
    </View>
  );
}

function confirm(title: string, message: string): Promise<boolean> {
  if (Platform.OS === "web") return Promise.resolve(globalThis.confirm?.(`${title}\n\n${message}`) ?? false);
  return new Promise((resolve) =>
    Alert.alert(title, message, [
      { text: "Cancel", style: "cancel", onPress: () => resolve(false) },
      { text: "Disconnect", style: "destructive", onPress: () => resolve(true) },
    ]),
  );
}

/** Removing the source drops the stored config but keeps its events (except sample data). */
export function DisconnectButton({ sourceId, label, removesData }: { sourceId: string; label: string; removesData?: boolean }) {
  const action = useAction();
  return (
    <Button
      variant="danger"
      busy={action.busy}
      onPress={async () => {
        const ok = await confirm(
          `Disconnect ${label}?`,
          removesData ? "All of its records are deleted." : "Events already synced stay — only the connection is removed.",
        );
        if (ok) void action.run(() => disconnectSource(sourceId));
      }}
    >
      Disconnect
    </Button>
  );
}

/**
 * GitHub needs a client secret for the code exchange, so this is the one flow
 * that goes through the worker: open its /oauth/github/start in a browser
 * session, and it redirects back to the app with the token in the URL fragment.
 */
export function GitHubConnect() {
  const action = useAction();
  return (
    <View className="gap-3">
      <Pressable
        onPress={() =>
          void action.run(async () => {
            const redirect = Linking.createURL("oauth/github");
            const workerUrl = (await getSetting("workerUrl")).replace(/\/+$/, "");
            const start = `${workerUrl}/oauth/github/start?redirect=${encodeURIComponent(redirect)}`;
            const result = await WebBrowser.openAuthSessionAsync(start, redirect);
            if (result.type !== "success") return { message: null, error: null };

            const url = new URL(result.url);
            const params = new URLSearchParams(url.hash.replace(/^#/, ""));
            const error = url.searchParams.get("error");
            if (error) throw new Error(error);
            const token = params.get("token");
            const username = params.get("username");
            if (!token || !username) throw new Error("GitHub did not return a token.");

            const change = await connectSource({
              provider: "github",
              label: `GitHub — ${username}`,
              config: { username, token },
              timezone: await getSetting("timezone"),
            });
            return describe(change, "GitHub connected");
          })
        }
        className="flex-row items-center gap-2 self-start rounded-lg bg-[#24292f] px-5 py-2.5 active:opacity-80"
      >
        <Text className="text-sm font-medium text-white">{action.busy ? "Connecting…" : "Connect with GitHub"}</Text>
      </Pressable>
      {action.message ? <Text className="text-sm text-positive">{action.message}</Text> : null}
      <ErrorText>{action.error}</ErrorText>
      <Text className="text-xs text-muted">You’ll approve read-only access on GitHub, then come straight back here.</Text>
    </View>
  );
}

/**
 * Spotify only lets an app's own developer authorise it until it is approved
 * for extended quota, so everyone brings their own Spotify app. With PKCE the
 * flow needs only the Client ID — no secret, no server.
 */
export function SpotifyConnect() {
  const [clientId, setClientId] = useState("");
  const [help, setHelp] = useState(false);
  const action = useAction();
  const redirectUri = makeRedirectUri({ scheme: "youai", path: "oauth/spotify" });

  const [request, response, promptAsync] = useAuthRequest(
    {
      clientId: clientId || "unset",
      scopes: SPOTIFY_SCOPES,
      usePKCE: true,
      responseType: ResponseType.Code,
      redirectUri,
    },
    SPOTIFY_DISCOVERY,
  );

  useEffect(() => {
    if (response?.type !== "success" || !request?.codeVerifier) return;
    const code = response.params.code;
    void action.run(async () => {
      const token = await exchangeCodeAsync(
        { clientId, code, redirectUri, extraParams: { code_verifier: request.codeVerifier! } },
        SPOTIFY_DISCOVERY,
      );
      if (!token.refreshToken) throw new Error("Spotify did not return a refresh token.");
      const change = await connectSource({
        provider: "spotify",
        config: { clientId, refreshToken: token.refreshToken },
        timezone: await getSetting("timezone"),
      });
      return describe(change, "Spotify connected");
    });
    // Only react to a new auth response.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [response]);

  return (
    <View className="gap-3">
      <Field label="Client ID" value={clientId} onChangeText={setClientId} placeholder="4f9a…" autoCapitalize="none" autoCorrect={false} />
      <Pressable
        disabled={!clientId.trim() || !request || action.busy}
        onPress={() => void promptAsync()}
        className="self-start rounded-lg bg-[#1db954] px-5 py-2.5 active:opacity-80 disabled:opacity-40"
      >
        <Text className="text-sm font-medium text-black">{action.busy ? "Connecting…" : "Connect with Spotify"}</Text>
      </Pressable>
      {action.message ? <Text className="text-sm text-positive">{action.message}</Text> : null}
      <ErrorText>{action.error}</ErrorText>
      <Pressable onPress={() => setHelp(!help)}>
        <Text className="text-xs text-muted underline">Where do I get this?</Text>
      </Pressable>
      {help ? (
        <View className="gap-1">
          <Text className="text-xs text-muted">1. Open developer.spotify.com/dashboard and click Create app.</Text>
          <Text className="text-xs text-muted">2. Add this Redirect URI exactly: {redirectUri} and tick Web API.</Text>
          <Text className="text-xs text-muted">3. Copy the app’s Client ID and paste it above. No secret needed.</Text>
        </View>
      ) : null}
    </View>
  );
}
