import { Hono, type Context } from "hono";
import { cors } from "hono/cors";

/**
 * The only server in you-ai. The app keeps all data on device; this worker
 * exists for the few things a device cannot do on its own:
 *
 *   - relay model calls to Nebius and searches to Tavily (no browser CORS, and
 *     it is the seam where subscriptions will plug in later);
 *   - finish OAuth flows that need a client secret (GitHub);
 *   - fetch iCal feeds for the web build (calendar hosts send no CORS headers).
 *
 * It stores nothing. Keys arrive per request and are forwarded, never logged.
 */

type Bindings = {
  /** Comma-separated origins allowed to call from a browser, e.g. the Pages URL. */
  ALLOWED_ORIGINS: string;
  NEBIUS_BASE_URL: string;
  GITHUB_CLIENT_ID?: string;
  GITHUB_CLIENT_SECRET?: string;
  /** Where GitHub sends the user back to, after the worker's callback: app scheme or web URL. */
  APP_REDIRECT_URLS: string;
  RATE_LIMITER?: RateLimit;
};

type Env = { Bindings: Bindings };

const app = new Hono<Env>();

app.use(
  "*",
  cors({
    origin: (origin, c) => {
      const allowed = (c.env as Bindings).ALLOWED_ORIGINS.split(",").map((o: string) => o.trim());
      return allowed.includes("*") || allowed.includes(origin) ? origin : null;
    },
    allowHeaders: ["content-type", "authorization", "x-user-key"],
    allowMethods: ["GET", "POST", "OPTIONS"],
    maxAge: 86400,
  }),
);

/** Per-IP limit so a leaked worker URL cannot be used as a free open relay. */
app.use("/ai/*", rateLimit);
app.use("/search", rateLimit);
app.use("/proxy/*", rateLimit);

async function rateLimit(c: Context<Env>, next: () => Promise<void>) {
  const limiter = c.env.RATE_LIMITER;
  if (limiter) {
    const ip = c.req.header("cf-connecting-ip") ?? "unknown";
    const { success } = await limiter.limit({ key: ip });
    if (!success) return c.json({ error: "Too many requests, slow down a little." }, 429);
  }
  await next();
}

app.get("/", (c) => c.json({ ok: true, service: "you-ai worker" }));

/**
 * Which key pays for this request. Today: the user's own (BYOK), sent as
 * `x-user-key`. Later: verify a subscription token here and return the
 * server's own key instead — the app will not need to change.
 */
function upstreamKey(c: Context<Env>): string | null {
  return c.req.header("x-user-key") ?? null;
}

/** OpenAI-compatible passthrough to Nebius, streaming included. */
app.all("/ai/v1/*", async (c) => {
  const key = upstreamKey(c);
  if (!key) return c.json({ error: "Missing API key. Add your Nebius key in Settings." }, 401);

  const path = c.req.path.replace(/^\/ai\/v1\//, "");
  const url = new URL(path, c.env.NEBIUS_BASE_URL.replace(/\/?$/, "/"));
  url.search = new URL(c.req.url).search;

  const upstream = await fetch(url, {
    method: c.req.method,
    headers: {
      "content-type": c.req.header("content-type") ?? "application/json",
      authorization: `Bearer ${key}`,
    },
    body: ["GET", "HEAD"].includes(c.req.method) ? undefined : c.req.raw.body,
  });

  // Pass the body through untouched so server-sent events stream as they arrive.
  return new Response(upstream.body, {
    status: upstream.status,
    headers: {
      "content-type": upstream.headers.get("content-type") ?? "application/json",
      "cache-control": "no-store",
    },
  });
});

/** Tavily search passthrough. */
app.post("/search", async (c) => {
  const key = upstreamKey(c);
  if (!key) return c.json({ error: "Missing API key. Add your Tavily key in Settings." }, 401);

  const upstream = await fetch("https://api.tavily.com/search", {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${key}` },
    body: await c.req.text(),
  });
  return new Response(upstream.body, {
    status: upstream.status,
    headers: { "content-type": upstream.headers.get("content-type") ?? "application/json" },
  });
});

/** Fetch a calendar feed for the web build. Only public http(s) iCal URLs. */
app.get("/proxy/ical", async (c) => {
  const raw = c.req.query("url") ?? "";
  let target: URL;
  try {
    target = new URL(raw.replace(/^webcal:\/\//i, "https://"));
  } catch {
    return c.json({ error: "Not a valid URL." }, 400);
  }
  if (target.protocol !== "https:") return c.json({ error: "Only https calendar URLs are allowed." }, 400);

  const upstream = await fetch(target, { headers: { accept: "text/calendar, text/plain, */*" } });
  if (!upstream.ok) return c.json({ error: `Calendar host returned ${upstream.status}.` }, 502);

  const text = await upstream.text();
  if (!text.includes("BEGIN:VCALENDAR")) return c.json({ error: "That URL is not an iCal feed." }, 400);
  return c.text(text, 200, { "content-type": "text/calendar; charset=utf-8" });
});

/* -------------------------------------------------------------------------- */
/*  GitHub OAuth: the one flow that needs a client secret                     */
/* -------------------------------------------------------------------------- */

/**
 * Step 1. The app opens this URL in a browser with `redirect` set to where it
 * wants the token delivered (its deep link, or the web app's URL). The
 * redirect is checked against an allowlist so the worker cannot be used to
 * hand tokens to someone else's site.
 */
app.get("/oauth/github/start", (c) => {
  if (!c.env.GITHUB_CLIENT_ID) return c.text("GitHub connect is not configured on this server.", 503);

  const redirect = c.req.query("redirect") ?? "";
  if (!isAllowedRedirect(c.env, redirect)) return c.text("Redirect not allowed.", 400);

  const state = btoa(JSON.stringify({ redirect, nonce: crypto.randomUUID() }));
  const authorize = new URL("https://github.com/login/oauth/authorize");
  authorize.searchParams.set("client_id", c.env.GITHUB_CLIENT_ID);
  authorize.searchParams.set("redirect_uri", new URL("/oauth/github/callback", c.req.url).toString());
  authorize.searchParams.set("scope", "read:user");
  authorize.searchParams.set("state", state);
  return c.redirect(authorize.toString());
});

/** Step 2. GitHub calls back here; swap the code for a token and bounce to the app. */
app.get("/oauth/github/callback", async (c) => {
  if (!c.env.GITHUB_CLIENT_ID || !c.env.GITHUB_CLIENT_SECRET) {
    return c.text("GitHub connect is not configured on this server.", 503);
  }

  let redirect = "";
  try {
    redirect = (JSON.parse(atob(c.req.query("state") ?? "")) as { redirect?: string }).redirect ?? "";
  } catch {
    return c.text("Invalid state.", 400);
  }
  if (!isAllowedRedirect(c.env, redirect)) return c.text("Redirect not allowed.", 400);

  const back = new URL(redirect);
  const code = c.req.query("code");
  if (!code) {
    back.searchParams.set("error", c.req.query("error") ?? "cancelled");
    return c.redirect(back.toString());
  }

  const tokenResponse = await fetch("https://github.com/login/oauth/access_token", {
    method: "POST",
    headers: { accept: "application/json", "content-type": "application/json" },
    body: JSON.stringify({
      client_id: c.env.GITHUB_CLIENT_ID,
      client_secret: c.env.GITHUB_CLIENT_SECRET,
      code,
    }),
  });
  const token = (await tokenResponse.json()) as { access_token?: string; error_description?: string };
  if (!token.access_token) {
    back.searchParams.set("error", token.error_description ?? "GitHub refused the code");
    return c.redirect(back.toString());
  }

  const userResponse = await fetch("https://api.github.com/user", {
    headers: { authorization: `Bearer ${token.access_token}`, "user-agent": "you-ai-worker" },
  });
  const user = (await userResponse.json()) as { login?: string };

  // Fragment, not query: it never reaches a server log on the way back.
  back.hash = new URLSearchParams({ token: token.access_token, username: user.login ?? "" }).toString();
  return c.redirect(back.toString());
});

function isAllowedRedirect(env: Bindings, redirect: string): boolean {
  if (!redirect) return false;
  return env.APP_REDIRECT_URLS.split(",")
    .map((prefix) => prefix.trim())
    .filter(Boolean)
    .some((prefix) => redirect.startsWith(prefix));
}

export default app;
