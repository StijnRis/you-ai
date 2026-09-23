/**
 * "Connect GitHub" for people who didn't sign in with GitHub: a plain OAuth
 * handshake that ends with a token stored on their GitHub source.
 *
 * Uses GITHUB_CONNECT_CLIENT_ID/SECRET if set, else the sign-in app's
 * AUTH_GITHUB_ID/SECRET. Either way the OAuth app's callback URL must be the
 * site's origin (e.g. http://localhost:3000) — GitHub accepts any path below it.
 */

export const STATE_COOKIE = "gh_connect_state";

export function githubOAuthApp() {
  const clientId = process.env.GITHUB_CONNECT_CLIENT_ID ?? process.env.AUTH_GITHUB_ID;
  const clientSecret = process.env.GITHUB_CONNECT_CLIENT_SECRET ?? process.env.AUTH_GITHUB_SECRET;
  return clientId && clientSecret ? { clientId, clientSecret } : null;
}

export function callbackUrl(request: Request): string {
  const origin = process.env.AUTH_URL ? new URL(process.env.AUTH_URL).origin : new URL(request.url).origin;
  return `${origin}/api/connect/github/callback`;
}
