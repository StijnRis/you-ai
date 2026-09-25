# Working in this repo

YouAI is a local-first personal analytics app: an Expo app (Android, iOS, web)
with all data in on-device SQLite, a small Cloudflare Worker, and an Astro
landing page. pnpm + turbo monorepo; everything is TypeScript. See README.md
for the layout and how the pieces fit.

## Hackathon mode

We are in a hackathon. Speed over polish.

- Work on one feature at a time. Do exactly what was asked — no extra scope,
  refactors or nice-to-haves.
- Keep it simple: the smallest change that works. No elaborate abstractions.
- Keep responses short.

## Rules

- **pnpm for everything** (`pnpm add`, `pnpm exec`, `pnpm dlx`). Never npm/npx.
  Don't install system software (databases, global tools) — everything runs
  from pnpm dependencies.
- Expo native packages: add them with `pnpm --filter @youai/mobile exec expo install <pkg>`
  so versions match the Expo SDK.
- **Where code goes:** logic in `packages/core` (plain TS, no React, no Expo
  imports); screens and platform glue in `apps/mobile`; shared components in
  `packages/ui`. Server-side code only in `apps/auth-worker`, and only for what
  needs a secret or CORS — user data never goes to the server.
- **Schema changes:** edit `packages/db/src/schema.ts`, then
  `pnpm --filter @youai/db generate` and commit the generated `drizzle/` files.
- **Secrets:** API keys live in secure storage on the device (`apps/mobile/lib/keys.ts`),
  never in SQLite and never in the repo. Worker secrets go in `.dev.vars` (local)
  or `wrangler secret put` (deployed).
- `patches/expo-sqlite@57.0.3.patch` fixes expo-sqlite's web sync calls
  (truncated results, too-short timeout). Re-check it when upgrading expo-sqlite.

## Checks

- `pnpm check` — typecheck + lint + tests. Run it before saying something is done.
- `pnpm test:e2e` — only when a change affects app flows.
- Add or update a test in `packages/core/test` when changing core logic;
  `useTestDb()` gives a fresh in-memory SQLite with the real migrations.
