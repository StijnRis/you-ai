import { z } from "zod";
import type { ApiAdapter } from "./types";
import type { NormalizedEvent } from "../mapping/apply";
import type { TypeMeta } from "../mapping/spec";
import { localDateOf } from "../events/time";

/**
 * Spotify listening via the recently-played endpoint. Spotify only exposes the
 * last 50 plays, so history builds up sync by sync rather
 * than being backfilled — dedupe keys make the overlap harmless.
 *
 * Access tokens last an hour, so every sync swaps the stored refresh token for
 * a fresh one first.
 */

const configSchema = z.object({
  /**
   * The user's own Spotify app (a public client — PKCE, no secret). Kept on
   * the source so everyone connects their own app.
   */
  clientId: z.string().min(1),
  /** Absent until the OAuth round-trip completes. Rotates on every refresh. */
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

export const SPOTIFY_SCOPES = ["user-read-recently-played"];

export const SPOTIFY_DISCOVERY = {
  authorizationEndpoint: "https://accounts.spotify.com/authorize",
  tokenEndpoint: "https://accounts.spotify.com/api/token",
};

export type SpotifyTokenResponse = {
  access_token?: string;
  refresh_token?: string;
  error_description?: string;
};

/**
 * Exchange an auth code (with its PKCE verifier) or a refresh token at
 * Spotify's token endpoint. PKCE clients send only `client_id`, no secret,
 * which is what lets this run on device.
 */
export async function spotifyToken(params: Record<string, string>): Promise<SpotifyTokenResponse> {
  const response = await fetch(SPOTIFY_DISCOVERY.tokenEndpoint, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(params).toString(),
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

  async fetch({ config, from, to, timezone }) {
    if (!config.refreshToken) {
      throw new Error("Spotify is not authorised yet — finish connecting it on the Sources screen.");
    }

    const token = await spotifyToken({
      grant_type: "refresh_token",
      refresh_token: config.refreshToken,
      client_id: config.clientId,
    });
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
    // PKCE refresh tokens are single-use: hand the new one back so sync stores it.
    return { events, config: token.refresh_token ? { refreshToken: token.refresh_token } : undefined };
  },
};
