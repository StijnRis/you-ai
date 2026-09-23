import { NextResponse, type NextRequest } from "next/server";
import { and, eq } from "drizzle-orm";
import { getUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { sources } from "@/lib/db/schema";
import { syncSource } from "@/lib/adapters/sync";
import { STATE_COOKIE, callbackUrl, githubOAuthApp } from "@/lib/adapters/github-oauth";

export const maxDuration = 60;

/** Step 2: GitHub sends the user back; swap the code for a token and connect. */
export async function GET(request: NextRequest) {
  const back = (query: string) => {
    const response = NextResponse.redirect(new URL(`/sources?${query}`, request.url));
    response.cookies.delete(STATE_COOKIE);
    return response;
  };
  const fail = (message: string) => back(`error=${encodeURIComponent(message)}`);

  const user = await getUser();
  if (!user) return NextResponse.redirect(new URL("/signin", request.url));

  const app = githubOAuthApp();
  const code = request.nextUrl.searchParams.get("code");
  const state = request.nextUrl.searchParams.get("state");
  if (!app) return fail("GitHub OAuth is not configured.");
  if (!code || !state || state !== request.cookies.get(STATE_COOKIE)?.value) {
    return fail("GitHub connection was cancelled or expired. Try again.");
  }

  const tokenResponse = await fetch("https://github.com/login/oauth/access_token", {
    method: "POST",
    headers: { accept: "application/json", "content-type": "application/json" },
    body: JSON.stringify({
      client_id: app.clientId,
      client_secret: app.clientSecret,
      code,
      redirect_uri: callbackUrl(request),
    }),
  });
  const token = (await tokenResponse.json().catch(() => ({}))) as {
    access_token?: string;
    error_description?: string;
  };
  if (!token.access_token) return fail(token.error_description ?? "GitHub did not return a token.");

  const profileResponse = await fetch("https://api.github.com/user", {
    headers: { authorization: `Bearer ${token.access_token}`, accept: "application/vnd.github+json" },
  });
  const profile = (await profileResponse.json().catch(() => ({}))) as { login?: string };
  if (!profile.login) return fail("Could not read your GitHub profile.");

  // Reconnecting refreshes the token on the existing source.
  const config = { username: profile.login, token: token.access_token };
  const [existing] = await db
    .select({ id: sources.id })
    .from(sources)
    .where(and(eq(sources.userId, user.id), eq(sources.kind, "api"), eq(sources.provider, "github")))
    .limit(1);

  const sourceId = existing
    ? (await db.update(sources).set({ config, label: `GitHub — ${profile.login}` }).where(eq(sources.id, existing.id)).returning())[0].id
    : (
        await db
          .insert(sources)
          .values({ userId: user.id, kind: "api", provider: "github", label: `GitHub — ${profile.login}`, config })
          .returning()
      )[0].id;

  try {
    await syncSource({ userId: user.id, timezone: user.timezone, sourceId });
  } catch (error) {
    return fail(`Connected, but the first sync failed: ${error instanceof Error ? error.message : String(error)}`);
  }
  return back("connected=github");
}
