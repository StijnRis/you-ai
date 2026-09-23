import { NextResponse, type NextRequest } from "next/server";
import { and, eq } from "drizzle-orm";
import { getUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { sources } from "@/lib/db/schema";
import { syncSource } from "@/lib/adapters/sync";
import { SPOTIFY_STATE_COOKIE, spotifyCallbackUrl, spotifyToken } from "@/lib/adapters/spotify";

export const maxDuration = 60;

/** Step 2: Spotify sends the user back; swap the code for tokens and connect. */
export async function GET(request: NextRequest) {
  const back = (query: string) => {
    const response = NextResponse.redirect(new URL(`/sources?${query}`, request.url));
    response.cookies.delete(SPOTIFY_STATE_COOKIE);
    return response;
  };
  const fail = (message: string) => back(`error=${encodeURIComponent(message)}`);

  const user = await getUser();
  if (!user) return NextResponse.redirect(new URL("/signin", request.url));

  const code = request.nextUrl.searchParams.get("code");
  const state = request.nextUrl.searchParams.get("state");
  if (!code || !state || state !== request.cookies.get(SPOTIFY_STATE_COOKIE)?.value) {
    return fail("Spotify connection was cancelled or expired. Try again.");
  }

  let token;
  try {
    token = await spotifyToken({
      grant_type: "authorization_code",
      code,
      redirect_uri: spotifyCallbackUrl(request),
    });
  } catch (error) {
    return fail(error instanceof Error ? error.message : String(error));
  }
  if (!token.access_token || !token.refresh_token) {
    return fail(token.error_description ?? "Spotify did not return a token.");
  }

  const profile = (await fetch("https://api.spotify.com/v1/me", {
    headers: { authorization: `Bearer ${token.access_token}` },
  })
    .then((response) => response.json())
    .catch(() => ({}))) as { display_name?: string; id?: string };
  const name = profile.display_name ?? profile.id ?? "Spotify";

  // Reconnecting refreshes the token on the existing source.
  const config = { refreshToken: token.refresh_token, displayName: name };
  const label = `Spotify — ${name}`;
  const [existing] = await db
    .select({ id: sources.id })
    .from(sources)
    .where(and(eq(sources.userId, user.id), eq(sources.kind, "api"), eq(sources.provider, "spotify")))
    .limit(1);

  const sourceId = existing
    ? (await db.update(sources).set({ config, label }).where(eq(sources.id, existing.id)).returning())[0].id
    : (await db.insert(sources).values({ userId: user.id, kind: "api", provider: "spotify", label, config }).returning())[0].id;

  try {
    await syncSource({ userId: user.id, timezone: user.timezone, sourceId });
  } catch (error) {
    return fail(`Connected, but the first sync failed: ${error instanceof Error ? error.message : String(error)}`);
  }
  return back("connected=spotify");
}
