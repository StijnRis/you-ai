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

Copy the `.env.example` to `.env.local` and fill in `AUTH_SECRET`, `ADMIN_PASSWORD`
and `NEBIUS_API_KEY`. Then, one command per line — no trailing comments, because
`cmd.exe` does not treat `#` as one and will pass the rest of the line as arguments:

```bash
pnpm install
pnpm dev:db
```

`pnpm dev:db` is Postgres-in-WASM; leave it running in its own terminal. Skip it
entirely if `DATABASE_URL` already points somewhere real — see below. In a second
terminal:

```bash
pnpm db:push
pnpm db:seed --admin
pnpm dev
```

`db:push` creates the schema, `db:seed --admin` loads the built-in conversions and
the admin account. Sample data is under Sources → Sample data.

Open <http://localhost:3000> and sign in as `admin@youai.nl` with the password you put
in `ADMIN_PASSWORD`.

`pnpm dev:db` must stay running — if sign-in fails with `CallbackRouteError`, that is
usually what stopped. If it fails with `EADDRINUSE: 127.0.0.1:5433`, one is already
running and you do not need a second.

**Every `db:` script talks to whatever `DATABASE_URL` is set to.** If that is the
shared Neon database rather than `localhost:5433`, then `pnpm dev:db` does nothing
useful and `db:push` / `db:seed` change the database the whole team is using —
`db:seed --admin` in particular resets the admin password there. Check which one you
are pointed at before running either.

## Accounts

Sign-in is required; there is no guest mode. Three ways in, all optional except the
first:

- **Email and password** — bcrypt, 10-character minimum. **No email verification**, so
  an account works the moment it is created. That is a deliberate trade for ease of
  sign-up, and it is the reason the OAuth providers below set
  `allowDangerousEmailAccountLinking`: someone could register an address they do not
  own, and the real owner's Google sign-in would then join that account. Turn that flag
  off in `lib/auth.ts` if you would rather have the friction.
- **Google** and **GitHub** — set up below.

### Roles

Whoever signs up with `ADMIN_EMAIL` (default `admin@youai.nl`) becomes an admin, by any
route. Everyone else is a regular user. `/admin` is guarded server-side, and every admin
server action re-checks the role rather than trusting the page that rendered the button.

Admins can promote and demote, disable sign-in without destroying data, delete accounts,
and change instance settings. The app refuses to leave itself with no active admin.

### Setting up Google sign-in

1. Go to <https://console.cloud.google.com/apis/credentials>, pick or create a project.
2. **OAuth consent screen** → External → fill in the app name and your support email.
   While it is in *Testing*, add yourself under **Test users**.
3. **Credentials** → **Create credentials** → **OAuth client ID** → **Web application**.
4. Under **Authorised redirect URIs** add exactly:
   - `http://localhost:3000/api/auth/callback/google`
   - `https://your-domain.vercel.app/api/auth/callback/google`
5. Copy the client ID and secret into `AUTH_GOOGLE_ID` and `AUTH_GOOGLE_SECRET`.

### Setting up GitHub sign-in

1. Go to <https://github.com/settings/developers> → **OAuth Apps** → **New OAuth App**.
2. Homepage URL `http://localhost:3000`, Authorization callback URL
   `http://localhost:3000/api/auth/callback/github`.
3. **Generate a new client secret**, then copy both into `AUTH_GITHUB_ID` and
   `AUTH_GITHUB_SECRET`.
4. A GitHub OAuth app allows only one callback URL, so create a second app for
   production rather than editing this one.

Each provider's button only appears once both of its variables are set, so the sign-in
page never offers a route that cannot work.

### Profile

`/profile` shows what the account owns, and lets you change your name, timezone and
coordinates, set or change a password (accounts created through Google or GitHub start
without one), and delete the account. Deleting cascades: events, daily metrics, imports,
sources and any conversions written for your data all go, and it asks you to type your
email first.

### Scripts

| Command | What it does |
|---|---|
| `pnpm dev` / `pnpm build` | the app |
| `pnpm dev:db` | in-process Postgres on `:5433` (no Docker) |
| `pnpm db:push` / `db:generate` / `db:studio` | schema |
| `pnpm db:seed [--admin]` | conversions, optionally the admin account |
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

## Admin settings

`/admin` lists every account and exposes instance-wide options that take effect
immediately, with no redeploy: whether sign-ups are open, whether unknown formats may be
sent to the model, the default timezone, the upload size cap, the chat model, and the
correlation defaults (minimum overlap, maximum lag, significance threshold). Each is
declared once in `lib/settings-def.ts` — adding one is a single entry, not a migration.

## Deploying

Vercel + Neon. Set `DATABASE_URL`, `AUTH_SECRET`, `ADMIN_EMAIL`, the OAuth variables you
want, `NEBIUS_API_KEY` and `CRON_SECRET`. `vercel.json` registers the nightly sync at
04:00.

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
- There is no password reset, because there is no email sending. An admin can set a new
  password by re-running `pnpm db:seed --admin`, or a user can sign in with Google or
  GitHub and set one from `/profile`.
- No rate limiting on the sign-in endpoint.
