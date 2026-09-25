# @youai/db

Drizzle SQLite schema (`src/schema.ts`) and generated migrations (`drizzle/`). `db` in `src/client.ts` is a lazy handle the app sets once with `setDb()`.

After changing the schema: `pnpm generate`, and commit the generated files. Instants are integer ms, JSON is text, calendar days are `YYYY-MM-DD` text.
