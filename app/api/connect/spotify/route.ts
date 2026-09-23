import { NextResponse } from "next/server";
import { getUser } from "@/lib/auth";
import { SPOTIFY_STATE_COOKIE as STATE_COOKIE, spotifyApp, spotifyCallbackUrl } from "@/lib/adapters/spotify";

/** Step 1: send the user to Spotify's consent screen. */
export async function GET(request: Request) {
  const user = await getUser();
  if (!user) return NextResponse.redirect(new URL("/signin", request.url));

  const app = spotifyApp();
  if (!app) return NextResponse.redirect(new URL("/sources?error=Spotify+is+not+configured", request.url));

  const state = crypto.randomUUID();
  const authorize = new URL("https://accounts.spotify.com/authorize");
  authorize.searchParams.set("client_id", app.clientId);
  authorize.searchParams.set("response_type", "code");
  authorize.searchParams.set("redirect_uri", spotifyCallbackUrl(request));
  authorize.searchParams.set("scope", "user-read-recently-played user-read-private");
  authorize.searchParams.set("state", state);

  const response = NextResponse.redirect(authorize);
  response.cookies.set(STATE_COOKIE, state, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    maxAge: 600,
    path: "/",
  });
  return response;
}
