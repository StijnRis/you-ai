# @youai/mobile

The Expo app (Android, iOS, web). Screens live in `app/` (expo-router file routes; tabs in `app/(tabs)`), platform glue in `lib/`, app-only components in `components/`.

- Business logic is imported from `@youai/core`, not written here.
- `lib/database.ts` opens SQLite and runs migrations at start-up; `lib/use-query.ts` + `notifyDataChanged()` refresh screens after writes.
- Styling is NativeWind (Tailwind classes); theme colours are CSS variables in `global.css`.
- Web needs cross-origin isolation for SQLite (`public/_headers`, and the dev server middleware in `metro.config.js`).

```bash
pnpm web | android | ios   # dev
pnpm build                 # web export to dist/
pnpm test:e2e              # Playwright against dist/
```
