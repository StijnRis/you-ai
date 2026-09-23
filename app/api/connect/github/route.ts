import { NextResponse } from "next/server";
import { getUser } from "@/lib/auth";
import { STATE_COOKIE, callbackUrl, githubOAuthApp } from "@/lib/adapters/github-oauth";

/** Step 1: send the user to GitHub's consent screen. */
export async function GET(request: Request) {
  const user = await getUser();
  if (!user) return NextResponse.redirect(new URL("/signin", request.url));

  const app = githubOAuthApp();
  if (!app) return NextResponse.redirect(new URL("/sources?error=GitHub+OAuth+is+not+configured", request.url));

  const state = crypto.randomUUID();
  const authorize = new URL("https://github.com/login/oauth/authorize");
  authorize.searchParams.set("client_id", app.clientId);
  authorize.searchParams.set("redirect_uri", callbackUrl(request));
  // Enough for public activity and the contribution calendar; `repo` would
  // mean asking for write access to their code.
  authorize.searchParams.set("scope", "read:user");
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
