import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import app from "../src/index";

const env = {
  ALLOWED_ORIGINS: "http://localhost:8081",
  NEBIUS_BASE_URL: "https://nebius.test/v1/",
  APP_REDIRECT_URLS: "youai://,http://localhost:8081",
  GITHUB_CLIENT_ID: "client-id",
  GITHUB_CLIENT_SECRET: "client-secret",
};

const upstream = vi.fn<typeof fetch>();

beforeEach(() => {
  upstream.mockReset();
  upstream.mockResolvedValue(new Response(JSON.stringify({ ok: true }), { headers: { "content-type": "application/json" } }));
  vi.stubGlobal("fetch", upstream);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

const request = (path: string, init?: RequestInit) => app.request(path, init, env);

describe("AI passthrough", () => {
  it("requires the user's key", async () => {
    const res = await request("/ai/v1/chat/completions", { method: "POST", body: "{}" });
    expect(res.status).toBe(401);
    expect(upstream).not.toHaveBeenCalled();
  });

  it("forwards to Nebius with the user's key as the bearer token", async () => {
    const res = await request("/ai/v1/chat/completions", {
      method: "POST",
      headers: { "x-user-key": "sk-user", "content-type": "application/json" },
      body: JSON.stringify({ model: "m" }),
    });
    expect(res.status).toBe(200);
    const [url, init] = upstream.mock.calls[0];
    expect(String(url)).toBe("https://nebius.test/v1/chat/completions");
    expect((init?.headers as Record<string, string>).authorization).toBe("Bearer sk-user");
  });
});

describe("search passthrough", () => {
  it("forwards to Tavily with the user's key", async () => {
    await request("/search", { method: "POST", headers: { "x-user-key": "tvly-user" }, body: JSON.stringify({ query: "q" }) });
    const [url, init] = upstream.mock.calls[0];
    expect(String(url)).toBe("https://api.tavily.com/search");
    expect((init?.headers as Record<string, string>).authorization).toBe("Bearer tvly-user");
  });
});

describe("CORS", () => {
  it("allows the app's origin and not others", async () => {
    const preflight = (origin: string) =>
      request("/ai/v1/chat/completions", {
        method: "OPTIONS",
        headers: { origin, "access-control-request-method": "POST" },
      });
    expect((await preflight("http://localhost:8081")).headers.get("access-control-allow-origin")).toBe("http://localhost:8081");
    expect((await preflight("https://evil.example")).headers.get("access-control-allow-origin")).toBeNull();
  });
});

describe("iCal proxy", () => {
  it("only fetches https calendar feeds", async () => {
    expect((await request("/proxy/ical?url=http://example.com/cal.ics")).status).toBe(400);
    expect((await request("/proxy/ical?url=not-a-url")).status).toBe(400);
  });

  it("returns the feed text for a real calendar", async () => {
    upstream.mockResolvedValue(new Response("BEGIN:VCALENDAR\nEND:VCALENDAR"));
    const res = await request(`/proxy/ical?url=${encodeURIComponent("webcal://example.com/cal.ics")}`);
    expect(res.status).toBe(200);
    expect(await res.text()).toContain("BEGIN:VCALENDAR");
    expect(String(upstream.mock.calls[0][0])).toBe("https://example.com/cal.ics");
  });
});

describe("GitHub OAuth", () => {
  it("refuses to redirect tokens to an unknown site", async () => {
    const res = await request(`/oauth/github/start?redirect=${encodeURIComponent("https://evil.example/cb")}`);
    expect(res.status).toBe(400);
  });

  it("sends the user to GitHub with a state that carries the app redirect", async () => {
    const res = await request(`/oauth/github/start?redirect=${encodeURIComponent("youai://oauth/github")}`);
    expect(res.status).toBe(302);
    const location = new URL(res.headers.get("location")!);
    expect(location.origin).toBe("https://github.com");
    expect(JSON.parse(atob(location.searchParams.get("state")!)).redirect).toBe("youai://oauth/github");
  });

  it("exchanges the code and returns the token to the app in the URL fragment", async () => {
    upstream
      .mockResolvedValueOnce(Response.json({ access_token: "gho_token" }))
      .mockResolvedValueOnce(Response.json({ login: "octocat" }));
    const state = btoa(JSON.stringify({ redirect: "youai://oauth/github", nonce: "n" }));
    const res = await request(`/oauth/github/callback?code=abc&state=${encodeURIComponent(state)}`);
    expect(res.status).toBe(302);
    const location = res.headers.get("location")!;
    expect(location.startsWith("youai://oauth/github#")).toBe(true);
    expect(location).toContain("token=gho_token");
    expect(location).toContain("username=octocat");
  });
});
