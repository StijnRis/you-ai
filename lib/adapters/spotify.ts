import { z } from "zod";
import type { ApiAdapter } from "@/lib/adapters/types";
import type { NormalizedEvent } from "@/lib/mapping/apply";
import type { TypeMeta } from "@/lib/mapping/spec";
import { localDateOf } from "@/lib/events/time";

/**
 * Spotify listening via the recently-played endpoint. Spotify only exposes the
 * last 50 plays, so history builds up sync by sync (the nightly cron) rather
 * than being backfilled — dedupe keys make the overlap harmless.
 *
 * Access tokens last an hour, so every sync swaps the stored refresh token for
 * a fresh one first.
 */

const configSchema = z.object({
  /**
   * The user's own Spotify app. Kept on the source rather than in the
   * environment so everyone connects their own app — and because the secret
   * is needed again on every sync to refresh the access token.
   */
  clientId: z.string().min(1),
  clientSecret: z.string().min(1),
  /** Absent until the OAuth round-trip completes. */
  refreshToken: z.string().optional(),
  displayName: z.string().optional(),
});

export type SpotifyConfig = z.infer<typeof configSchema>;

const TYPES: Record<string, TypeMeta> = {
  "spotify.tracks": {
    label: "Tracks played",
    unit: "tracks",
    valueKind: "numeric",
    aggregation: "count",
    polarity: 0,
    category: "media",
    correlatable: true,
  },
  "spotify.listening_minutes": {
    label: "Listening time",
    unit: "min",
    valueKind: "duration",
    aggregation: "sum",
    polarity: 0,
    category: "media",
    correlatable: true,
  },
};

export const SPOTIFY_STATE_COOKIE = "spotify_connect_state";
/** Carries the user's app credentials across the OAuth round-trip. */
export const SPOTIFY_CREDS_COOKIE = "spotify_connect_app";

export function packCredentials(app: SpotifyApp): string {
  return Buffer.from(JSON.stringify(app)).toString("base64url");
}

export function unpackCredentials(value: string | undefined): SpotifyApp | null {
  if (!value) return null;
  try {
    const parsed = JSON.parse(Buffer.from(value, "base64url").toString());
    return typeof parsed?.clientId === "string" && typeof parsed?.clientSecret === "string"
      ? { clientId: parsed.clientId, clientSecret: parsed.clientSecret }
      : null;
  } catch {
    return null;
  }
}

/** Must match a Redirect URI in the Spotify app exactly (127.0.0.1, not localhost). */
export function spotifyCallbackUrl(request: Request): string {
  const origin = process.env.AUTH_URL ? new URL(process.env.AUTH_URL).origin : new URL(request.url).origin;
  return `${origin}/api/connect/spotify/callback`;
}

/**
 * The same URL, for a server component that has headers rather than a Request.
 * Shown to the user so they can paste it into their Spotify app verbatim —
 * Spotify matches redirect URIs exactly.
 */
export function spotifyCallbackUrlFrom(origin: string): string {
  const base = process.env.AUTH_URL ? new URL(process.env.AUTH_URL).origin : origin;
  return `${base}/api/connect/spotify/callback`;
}

export type SpotifyApp = { clientId: string; clientSecret: string };

/**
 * Deployment-wide credentials, if the host set any. Optional: they exist so an
 * operator *can* run a shared Spotify app, but the normal path is each user
 * bringing their own.
 */
export function spotifyApp(): SpotifyApp | null {
  const clientId = process.env.SPOTIFY_CLIENT_ID;
  const clientSecret = process.env.SPOTIFY_CLIENT_SECRET;
  return clientId && clientSecret ? { clientId, clientSecret } : null;
}

/** Exchange an auth code or a refresh token at Spotify's token endpoint. */
export async function spotifyToken(
  params: Record<string, string>,
  app: SpotifyApp,
): Promise<{ access_token?: string; refresh_token?: string; error_description?: string }> {
  const response = await fetch("https://accounts.spotify.com/api/token", {
    method: "POST",
    headers: {
      "content-type": "application/x-www-form-urlencoded",
      authorization: `Basic ${Buffer.from(`${app.clientId}:${app.clientSecret}`).toString("base64")}`,
    },
    body: new URLSearchParams(params),
  });
  return response.json();
}

type RecentlyPlayed = {
  items?: {
    played_at: string;
    track: { id: string; name: string; duration_ms: number; artists: { name: string }[] };
  }[];
};

export const spotifyAdapter: ApiAdapter<SpotifyConfig> = {
  provider: "spotify",
  label: "Spotify",
  description: "Tracks played and listening time per day. Spotify shares your last 50 plays, so history grows with every sync.",
  types: TYPES,

  validateConfig(config: unknown): SpotifyConfig {
    return configSchema.parse(config);
  },

  async fetch({ config, from, to, timezone }): Promise<NormalizedEvent[]> {
    if (!config.refreshToken) {
      throw new Error("Spotify is not authorised yet — finish connecting it on the Sources page.");
    }

    const token = await spotifyToken(
      { grant_type: "refresh_token", refresh_token: config.refreshToken },
      { clientId: config.clientId, clientSecret: config.clientSecret },
    );
    if (!token.access_token) {
      throw new Error(`Spotify refused the refresh: ${token.error_description ?? "reconnect Spotify"}`);
    }

    const response = await fetch("https://api.spotify.com/v1/me/player/recently-played?limit=50", {
      headers: { authorization: `Bearer ${token.access_token}` },
    });
    if (!response.ok) throw new Error(`Spotify returned ${response.status}: ${(await response.text()).slice(0, 200)}`);
    const payload = (await response.json()) as RecentlyPlayed;

    const events: NormalizedEvent[] = [];
    for (const item of payload.items ?? []) {
      const startedAt = new Date(item.played_at);
      const localDate = localDateOf(startedAt, timezone);
      if (localDate < from || localDate > to) continue;

      const minutes = Math.round((item.track.duration_ms / 60_000) * 10) / 10;
      const title = `${item.track.artists.map((a) => a.name).join(", ")} — ${item.track.name}`;
      const common = {
        startedAt,
        endedAt: new Date(startedAt.getTime() + item.track.duration_ms),
        durationS: Math.round(item.track.duration_ms / 1000),
        valueText: title,
        localDate,
        meta: { trackId: item.track.id },
      };
      events.push(
        { ...common, typeKey: "spotify.tracks", value: 1, dedupeKey: `spotify:${item.played_at}:track` },
        { ...common, typeKey: "spotify.listening_minutes", value: minutes, dedupeKey: `spotify:${item.played_at}:min` },
      );
    }
    return events;
  },
};
