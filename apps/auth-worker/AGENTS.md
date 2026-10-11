# @youai/auth-worker

The only server. Stateless Hono app on Cloudflare Workers (`src/index.ts`):

- `/ai/*` streams to the provider named in `x-upstream-url`, `/search` to Tavily, using the key the app sends in `x-user-key`. `upstreamKey()` is where subscriptions will plug in.
- `/oauth/github/*` does the code exchange that needs the client secret.
- `/proxy/ical` fetches calendar feeds for the web build (no CORS on calendar hosts).

Never store or log user keys or data. Tests (`test/`) call `app.request()` with a stubbed `fetch`.

```bash
pnpm dev     # http://localhost:8787 (secrets from .dev.vars)
pnpm test
```
