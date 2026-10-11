# YouAI

Personal analytics that stay yours: pull in what you already track (activity,
sleep, mood, weather, calendar, music, code), find the patterns that only show
up when two sources are laid over each other, and ask about them in plain
language.

**Local-first.** All data lives in a SQLite database on the device. There are
no accounts yet; syncing between devices comes later. A small Cloudflare Worker
exists only for what a device cannot do alone: relay AI calls, finish OAuth
flows that need a secret, and fetch calendars for the web build.

One Expo app runs on Android, iOS and the web.

## Layout

```
apps/
  mobile/        Expo app (Android, iOS, web): expo-router, NativeWind, expo-sqlite
  auth-worker/   Cloudflare Worker (Hono): AI + search relay, GitHub OAuth, iCal proxy
  web-landing/   Marketing site (Astro, static), deployed to Cloudflare Pages
packages/
  core/          All app logic in plain TypeScript: import pipeline, adapters, stats, experiments, AI tools
  db/            Drizzle SQLite schema + generated migrations
  ui/            Shared React Native components and charts
  config-ts/     Shared tsconfig bases
  config-eslint/ Shared ESLint config
test/fixtures/   Sample export files used by the tests
```

## Getting started

Needs Node 24+ and pnpm. Nothing else to install: SQLite runs inside the app.

```bash
pnpm bootstrap                         # checks tools, installs, creates local config
pnpm --filter @youai/auth-worker dev   # worker on http://localhost:8787
pnpm --filter @youai/mobile web        # the app in a browser (or: android / ios)
```

In the app, open **More → Settings** and enter an
OpenAI-compatible API URL, model and key (OpenAI, Claude, Gemini, OpenRouter, ...) to turn on chat,
experiment evaluation and conversions for unknown files. A Tavily key
(optional) lets the assistant search the web. Keys stay in the device's secure
storage.

To look around without real data: **More → Sources → Sample data → Connect**.

## Checks

```bash
pnpm check      # typecheck + lint + unit/integration tests (turbo, cached)
pnpm build      # Expo web export, Astro site, worker dry-run deploy
pnpm test:e2e   # Playwright against the web build (uses your installed Chrome)
```

GitHub Actions runs all three on every push and pull request
(`.github/workflows/ci.yml`).

- **Unit and integration tests** (Vitest) live next to the code in
  `packages/core/test` and `apps/auth-worker/test`. The core tests run the real
  migrations and SQL against an in-memory SQLite (sql.js), so the same queries
  are exercised as on the device.
- **End-to-end tests** live in `apps/mobile/e2e`. Every test starts with an
  empty on-device database.

## How the pieces fit

- **One table for every kind of event.** An event has a time, an optional
  duration, a type key and a value; `event_types` says what each type means.
  A new metric is a row, never a migration.
- **Conversions are data, not code.** Each import format is a JSON
  `MappingSpec`, so it can be shown, edited and safely written by a model.
- **Formats are recognised, not re-derived.** A file's shape is fingerprinted.
  Only a genuinely new shape reaches the model, once.
- **Two adapter kinds, one pipeline.** File imports and live APIs produce the
  same events; dedupe, the daily rollup, correlation and chat can't tell them
  apart.
- **AI is bring-your-own-key, through the worker.** The app always calls the
  worker, which forwards the user's key and stores nothing. A future
  subscription only changes how the worker picks the key (`upstreamKey` in
  `apps/auth-worker/src/index.ts`).

## Deploying

- Worker: `pnpm --filter @youai/auth-worker deploy`, then
  `pnpm --filter @youai/auth-worker exec wrangler secret put GITHUB_CLIENT_SECRET`.
  Set `ALLOWED_ORIGINS`, `APP_REDIRECT_URLS` and `GITHUB_CLIENT_ID` in `wrangler.jsonc`.
- Web app: `pnpm --filter @youai/mobile build`, then
  `pnpm --filter @youai/mobile exec wrangler pages deploy dist --project-name youai-app`.
- Landing: `pnpm --filter @youai/web-landing build && pnpm --filter @youai/web-landing deploy`.
- Native apps: EAS Build (not set up yet).
