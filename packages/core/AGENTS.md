# @youai/core

All app logic as plain TypeScript: import pipeline (`import/`, `mapping/`, `readers/`), live API adapters (`adapters/`), ingest and daily rollup (`events/`), statistics (`stats/`), experiments, mood, settings and the AI chat + tools (`chat/`, `ai/`).

- No React or Expo imports: it must run on device, on web and in Node tests.
- Database access goes through `db` from `@youai/db`, which the app installs at start-up.
- Model calls go through `ai/provider.ts` (the worker), never straight to a provider.
- Tests in `test/`; `useTestDb()` gives each test a fresh in-memory SQLite with the real migrations.

```bash
pnpm test
```
