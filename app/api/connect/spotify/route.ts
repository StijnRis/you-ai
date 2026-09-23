import { NextResponse } from "next/server";
import { getUser } from "@/lib/auth";
import {
  SPOTIFY_CREDS_COOKIE,
  SPOTIFY_STATE_COOKIE as STATE_COOKIE,
  packCredentials,
  spotifyApp,
  spotifyCallbackUrl,
  type SpotifyApp,
} from "@/lib/adapters/spotify";

/**
 * Step 1: send the user to Spotify's consent screen.
 *
 * POST carries the user's own client id and secret from the form on the
 * Sources page; GET is the fallback for a deployment that has set a shared
 * app in the environment. Either way the credentials ride to the callback in
 * a short-lived httpOnly cookie rather than the query string, which would put
 * the secret in browser history and any proxy log on the way.
 */
export async function POST(request: Request) {
  const user = await getUser();
  if (!user) return NextResponse.redirect(new URL("/signin", request.url), 303);

  const form = await request.formData();
  const clientId = String(form.get("clientId") ?? "").trim();
  const clientSecret = String(form.get("clientSecret") ?? "").trim();

  if (!clientId || !clientSecret) {
    return fail(request, "Enter both the Client ID and the Client secret from your Spotify app.");
  }

  return start(request, { clientId, clientSecret });
}

export async function GET(request: Request) {
  const user = await getUser();
  if (!user) return NextResponse.redirect(new URL("/signin", request.url), 303);

  const app = spotifyApp();
  if (!app) {
    return fail(request, "Add your Spotify Client ID and secret on the Sources page to connect.");
  }

  return start(request, app);
}

function start(request: Request, app: SpotifyApp) {
  const state = crypto.randomUUID();
  const authorize = new URL("https://accounts.spotify.com/authorize");
  authorize.searchParams.set("client_id", app.clientId);
  authorize.searchParams.set("response_type", "code");
  authorize.searchParams.set("redirect_uri", spotifyCallbackUrl(request));
  authorize.searchParams.set("scope", "user-read-recently-played user-read-private");
  authorize.searchParams.set("state", state);

  // 303 so a POST turns into a GET on the way to Spotify.
  const response = NextResponse.redirect(authorize, 303);
  const options = {
    httpOnly: true,
    sameSite: "lax" as const,
    secure: process.env.NODE_ENV === "production",
    maxAge: 600,
    path: "/",
  };
  response.cookies.set(STATE_COOKIE, state, options);
  response.cookies.set(SPOTIFY_CREDS_COOKIE, packCredentials(app), options);
  return response;
}

function fail(request: Request, message: string) {
  return NextResponse.redirect(
    new URL(`/sources?error=${encodeURIComponent(message)}`, request.url),
    303,
  );
}
