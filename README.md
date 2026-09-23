# YouAI

Personal analytics in the spirit of [Exist.io](https://exist.io): pull everything you
already generate — activity, sleep, mood, weather, media — into one store, find the
patterns that only show up when two sources are laid over each other, and ask
questions about them in plain language.

Next.js 16 · Postgres (Neon) · Drizzle · Auth.js · Vercel AI SDK against Nebius Token Factory.

## The four ideas

**One table for every kind of event.** There is no `steps` table and no `weather`
table. An event has a time, an optional duration, a type key and a value; a second
table says what each type *means* — its unit, whether it sums or averages over a day,
whether more is better. Adding a new metric is a row, never a migration.

**Conversions are data, not code.** Every import format is described by a
`MappingSpec`: a JSON document saying which field holds the timestamp, which fields
become which metrics, and which transforms to run (`÷1000`, `round`, lookup tables).
Because it is data, it is stored in Postgres, rendered as a readable pipeline in the
UI, edited, versioned — and safely written by a model, which could never be trusted
with `eval`.

**Formats are recognised, not re-derived.** A file's format and field names are
hashed into a fingerprint. Seen it before? Reuse the stored conversion, free. A
built-in matches on required fields and filename? Use that, and remember the
fingerprint. Only a genuinely new shape reaches the model — once, ever.

**Two adapter kinds, one pipeline.** A data dump runs a `MappingSpec`; a live API
adapter builds the same events in TypeScript. Downstream — dedupe, daily rollup,
correlation, chat — neither can tell the difference.

## Quick start

```bash
pnpm install
cp .env.example .env.local     # fill in AUTH_SECRET and NEBIUS_API_KEY

pnpm dev:db                    # in another terminal: Postgres-in-WASM, nothing to install
pnpm db:push                   # create the schema
pnpm db:seed --demo            # built-in conversions + 180 days of synthetic data
pnpm dev
```

Open <http://localhost:3000> and choose **Continue as demo user**.

For the real thing, point `DATABASE_URL` at a Neon pooled connection string and drop
`DATABASE_POOL_MAX`.

### Scripts

| Command | What it does |
|---|---|
| `pnpm dev` / `pnpm build` | the app |
| `pnpm dev:db` | in-process Postgres on `:5433` (no Docker) |
| `pnpm db:push` / `db:generate` / `db:studio` | schema |
| `pnpm db:seed [--demo]` | built-in conversions, optionally demo data |
| `pnpm verify` | 39 checks: schema, rollup SQL, conversions, timezones, statistics |
| `pnpm verify:inference` | the model-writes-a-conversion path (needs `NEBIUS_API_KEY`) |
| `pnpm typecheck` | `tsc --noEmit` |

## How the data is stored

```
event_types   key, label, unit, value_kind, aggregation, polarity, category
events        user_id, type_key, started_at, ended_at, duration_s,
              value, value_text, local_date, meta, source_id, dedupe_key
daily_metrics user_id, local_date, type_key, value        ← derived rollup
```

Three details that matter more than they look:

- **`local_date` is resolved at ingest**, in the user's own timezone. A 23:30 workout
  belongs to that day, not to the next one in UTC, and every day-bucketed query stays
  a plain equality check.
- **`dedupe_key` makes imports idempotent.** Re-importing an overlapping export
  updates rows instead of doubling every number.
- **`daily_metrics` is the only thing the correlation engine reads.** Each type
  collapses its day with its own rule — steps sum, resting heart rate averages,
  weight takes the last reading — in one SQL pass.

## The inference engine

`lib/stats/correlate.ts` scores every pair of metrics at shifts of −3…+3 days:

- **Pearson and Spearman** together, so a monotonic-but-not-linear relationship is
  not missed and a single outlier cannot manufacture one.
- **Lags**, because the interesting findings are usually delayed — last night's sleep
  against today's mood.
- **Benjamini–Hochberg correction.** Thirty metrics at seven lags is thousands of
  tests; without correction a handful will always look "significant". `pnpm verify`
  asserts that eight pure-noise series produce zero findings.
- **Group comparisons** via Welch's t-test with Cohen's d: weekday vs weekend, or one
  metric split by another's terciles.

## Adapters

**Import** (`lib/import/run.ts`) — CSV, TSV, JSON, NDJSON, XML, and zips of them.
Built-ins ship for Apple Health `export.xml`, Google Fit daily activity CSV and
Strava `activities.csv`. Unknown formats go to the model, which fills in a
`MappingSpec` that is Zod-validated, dry-run against real sample rows, and retried
with the failure fed back if it produces nothing.

**Weather** (`lib/adapters/weather.ts`) — the direct-API proof of concept, via
Open-Meteo: no OAuth, no key, real historical archive. It stitches the archive
endpoint (which lags ~5 days) to the forecast endpoint for recent days, and backfills
a year on first connect. Add another adapter by implementing `ApiAdapter` and
registering it; the cron in `vercel.json` syncs them all nightly.

## Chat

`/api/chat` streams from Nebius with six tools over the event store: `list_metrics`,
`get_summary`, `get_daily_series`, `find_correlations`, `compare_groups`,
`list_events`. Each is bound to one user by closure — the model never supplies a user
id and cannot reach another account, however it is prompted. The tools return
*computed* results rather than raw rows, because a model asked to eyeball 400 numbers
will invent a trend, while one handed `r = −0.42 over 96 days` reads it correctly.

## Deploying

Vercel + Neon. Set `DATABASE_URL`, `AUTH_SECRET`, `AUTH_GITHUB_ID`/`SECRET`,
`NEBIUS_API_KEY` and `CRON_SECRET`; leave `ALLOW_DEMO_LOGIN` unset. `vercel.json`
registers the nightly sync at 04:00.

Uploads currently stream through the API route, so Vercel's 4.5 MB request limit
applies. For full Apple Health exports, upload to Vercel Blob from the client first
and hand the route a URL.

## Known limits

- Correlation is not causation, and the UI says so; seasonality drives a surprising
  number of findings.
- Editing a conversion and re-applying it (`/api/import/[id]/reapply`) has no UI yet —
  the endpoint and the stored upload bytes are there.
- Manual tracking (mood, energy, caffeine entered by hand) is not built; the schema
  already supports it, it needs a form.
