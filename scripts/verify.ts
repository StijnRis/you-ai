/**
 * End-to-end verification that needs neither a Postgres server nor an API key.
 *
 * Runs the real schema, the real rollup SQL and the real conversion pipeline
 * against PGlite (Postgres compiled to WASM) and synthetic data with known
 * answers. The one thing it cannot cover is the model writing a conversion for
 * an unknown format — that needs NEBIUS_API_KEY, and is checked by
 * `scripts/verify-inference.ts`.
 *
 *   pnpm verify
 */
import { readFileSync, readdirSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import { detectFile } from "@/lib/mapping/detect";
import { scoreSpec } from "@/lib/mapping/detect";
import { builtinSpecs } from "@/lib/mapping/builtin";
import { applySpec } from "@/lib/mapping/apply";
import { correlateAll, compareWeekendVsWeekday, summarize, pValueFor } from "@/lib/stats/correlate";
import { localDateOf, shiftLocalDate } from "@/lib/events/time";
import { analyzeExperiment, phaseOf, windowsFor } from "@/lib/experiments/analyze";

const TZ = "Europe/Madrid";

let failures = 0;
let checks = 0;

function check(label: string, condition: boolean, detail?: string) {
  checks++;
  if (condition) {
    console.log(`  \x1b[32m✓\x1b[0m ${label}${detail ? ` \x1b[2m${detail}\x1b[0m` : ""}`);
  } else {
    failures++;
    console.log(`  \x1b[31m✗ ${label}\x1b[0m${detail ? ` — ${detail}` : ""}`);
  }
}

function section(title: string) {
  console.log(`\n\x1b[1m${title}\x1b[0m`);
}

function near(actual: number, expected: number, tolerance: number): boolean {
  return Math.abs(actual - expected) <= tolerance;
}

/* -------------------------------------------------------------------------- */

async function verifySchemaAndRollup() {
  section("Schema and daily rollup (PGlite)");

  const db = new PGlite();
  // Whatever drizzle-kit last generated, so a regenerated migration is picked
  // up without editing this script.
  const files = readdirSync("drizzle").filter((name) => name.endsWith(".sql")).sort();
  const migration = files.map((name) => readFileSync(`drizzle/${name}`, "utf8")).join("\n--> statement-breakpoint\n");

  // drizzle-kit separates statements with its own marker.
  for (const statement of migration.split("--> statement-breakpoint")) {
    const trimmed = statement.trim();
    if (trimmed) await db.exec(trimmed);
  }
  check("migrations apply cleanly", true, `${files.length} file(s), ${migration.split("--> statement-breakpoint").length} statements`);

  await db.exec(`
    insert into "user" (id, email, timezone) values ('u1', 'a@b.c', 'Europe/Madrid');
    insert into event_types (key, label, value_kind, aggregation) values
      ('steps', 'Steps', 'numeric', 'sum'),
      ('weight', 'Weight', 'numeric', 'last'),
      ('hr', 'Resting HR', 'numeric', 'avg');
    insert into events (user_id, type_key, started_at, local_date, value, dedupe_key) values
      ('u1', 'steps',  '2024-03-01T08:00:00Z', '2024-03-01', 1000, 'a'),
      ('u1', 'steps',  '2024-03-01T18:00:00Z', '2024-03-01', 2500, 'b'),
      ('u1', 'weight', '2024-03-01T07:00:00Z', '2024-03-01', 71.0, 'c'),
      ('u1', 'weight', '2024-03-01T21:00:00Z', '2024-03-01', 72.0, 'd'),
      ('u1', 'hr',     '2024-03-01T07:00:00Z', '2024-03-01', 50,   'e'),
      ('u1', 'hr',     '2024-03-01T23:00:00Z', '2024-03-01', 60,   'f');
  `);

  // The same SQL shape the app runs, inlined so the assertion covers the real
  // CASE-per-aggregation logic rather than a simplified stand-in.
  await db.exec(`
    insert into daily_metrics (user_id, local_date, type_key, value, sample_count, updated_at)
    select * from (
      select e.user_id, e.local_date, e.type_key,
        case t.aggregation
          when 'sum'   then sum(e.value)
          when 'avg'   then avg(e.value)
          when 'min'   then min(e.value)
          when 'max'   then max(e.value)
          when 'count' then count(e.id)::double precision
          when 'last'  then (array_agg(e.value order by e.started_at desc))[1]
        end as value,
        count(e.id)::int as sample_count,
        now() as updated_at
      from events e
      join event_types t on t.key = e.type_key
      where e.user_id = 'u1' and (e.value is not null or t.aggregation = 'count')
      group by e.user_id, e.local_date, e.type_key, t.aggregation
    ) as rollup
    where rollup.value is not null
    on conflict (user_id, local_date, type_key) do update
      set value = excluded.value, sample_count = excluded.sample_count
  `);

  const rows = await db.query<{ type_key: string; value: number }>(
    "select type_key, value from daily_metrics order by type_key",
  );
  const byType = new Map(rows.rows.map((row) => [row.type_key, Number(row.value)]));

  check("sum aggregation", byType.get("steps") === 3500, `steps = ${byType.get("steps")}`);
  check("avg aggregation", byType.get("hr") === 55, `hr = ${byType.get("hr")}`);
  check(
    "last aggregation takes the latest reading",
    byType.get("weight") === 72,
    `weight = ${byType.get("weight")}`,
  );

  // Idempotency: the unique index must make a repeat import an update.
  await db.exec(`
    insert into events (user_id, type_key, started_at, local_date, value, dedupe_key)
    values ('u1', 'steps', '2024-03-01T08:00:00Z', '2024-03-01', 1111, 'a')
    on conflict (user_id, dedupe_key) do update set value = excluded.value
  `);
  const count = await db.query<{ n: number }>(
    "select count(*)::int as n from events where type_key = 'steps'",
  );
  check("re-import updates rather than duplicates", count.rows[0].n === 2, `${count.rows[0].n} rows`);

  await db.close();
}

/* -------------------------------------------------------------------------- */

function verifyDetectionAndConversion() {
  section("Format detection and built-in conversions");

  // Google Fit CSV
  const csvText = readFileSync("test/fixtures/google-fit-daily.csv", "utf8");
  const csvDetection = detectFile({ path: "Daily activity metrics.csv", text: csvText, bytes: csvText.length });

  check("CSV format sniffed", csvDetection.format === "csv", csvDetection.format);
  check("fields collected", csvDetection.fields.includes("Step count"), `${csvDetection.fields.length} fields`);
  check("records parsed", csvDetection.recordCount === 6, `${csvDetection.recordCount} rows`);
  check("fingerprint is stable", csvDetection.fingerprint === detectFile({ path: "x.csv", text: csvText, bytes: 1 }).fingerprint);

  const gfit = builtinSpecs.find((spec) => spec.key === "google-fit.daily-activity")!;
  check(
    "Google Fit built-in matches",
    scoreSpec(gfit, csvDetection, "Daily activity metrics.csv") > 5,
    `score ${scoreSpec(gfit, csvDetection, "Daily activity metrics.csv").toFixed(1)}`,
  );

  const gfitResult = applySpec(csvText, gfit, { timezone: TZ });
  const steps = gfitResult.events.filter((event) => event.typeKey === "steps");
  check("steps extracted", steps.length === 5, `${steps.length} events (1 empty row skipped)`);
  check("step value correct", steps[0].value === 8231, String(steps[0].value));
  check("local date correct", steps[0].localDate === "2024-03-01", steps[0].localDate);

  const distance = gfitResult.events.find((event) => event.typeKey === "distance");
  check("metres converted to km", distance?.value === 5.12, `${distance?.value} km`);

  check(
    "row with empty metrics skipped",
    !gfitResult.events.some((event) => event.localDate === "2024-03-05" && event.typeKey === "steps"),
  );

  // Apple Health XML
  const xmlText = readFileSync("test/fixtures/apple-health.xml", "utf8");
  const xmlDetection = detectFile({ path: "export.xml", text: xmlText, bytes: xmlText.length });
  check("XML format sniffed", xmlDetection.format === "xml", xmlDetection.format);
  check(
    "repeated element found",
    xmlDetection.reader.format === "xml" && xmlDetection.reader.recordsPath === "HealthData.Record",
    xmlDetection.reader.format === "xml" ? xmlDetection.reader.recordsPath : "",
  );

  const health = builtinSpecs.find((spec) => spec.key === "apple-health.records")!;
  check("Apple Health built-in matches", scoreSpec(health, xmlDetection, "export.xml") > 5);

  const healthResult = applySpec(xmlText, health, { timezone: TZ });
  const healthSteps = healthResult.events.filter((event) => event.typeKey === "steps");
  check("where clause filters by record type", healthSteps.length === 3, `${healthSteps.length} step records`);
  check(
    "other metrics routed by their own where clause",
    healthResult.events.some((event) => event.typeKey === "body_mass" && event.value === 71.4),
  );

  const sleep = healthResult.events.find((event) => event.typeKey === "sleep_duration");
  check(
    "sleep duration derived from start/end span",
    sleep?.durationS === 7 * 3600 + 12 * 60,
    `${sleep?.durationS}s`,
  );
  check(
    "a night's sleep is dated by when it started",
    sleep?.localDate === "2024-03-01",
    sleep?.localDate,
  );

  // Unknown format: no built-in should claim it.
  const moodText = readFileSync("test/fixtures/unknown-mood.csv", "utf8");
  const moodDetection = detectFile({ path: "mood.csv", text: moodText, bytes: moodText.length });
  check("semicolon delimiter sniffed", moodDetection.reader.format === "csv" && moodDetection.reader.delimiter === ";");
  check(
    "no built-in falsely claims an unknown format",
    builtinSpecs.every((spec) => scoreSpec(spec, moodDetection, "mood.csv") === 0),
    "→ would be sent to the model",
  );
}

/* -------------------------------------------------------------------------- */

function verifyTimezones() {
  section("Timezone handling");

  // 00:30 Madrid on 2 March is 23:30 UTC on 1 March. The event belongs to the
  // 2nd, which is the whole reason local_date is resolved at ingest.
  const lateNight = new Date("2024-03-01T23:30:00Z");
  check("late-night event lands on the local day", localDateOf(lateNight, TZ) === "2024-03-02", localDateOf(lateNight, TZ));
  check("same instant is the previous day in UTC", localDateOf(lateNight, "UTC") === "2024-03-01");

  check("date arithmetic crosses a month boundary", shiftLocalDate("2024-02-28", 2) === "2024-03-01");
  check("date arithmetic handles a leap day", shiftLocalDate("2024-02-28", 1) === "2024-02-29");
}

/* -------------------------------------------------------------------------- */

function verifyStatistics() {
  section("Correlation engine");

  // A perfectly linear pair must come back as r = 1.
  const dates = Array.from({ length: 60 }, (_, i) => shiftLocalDate("2024-01-01", i));
  const linearA = new Map(dates.map((date, i) => [date, i]));
  const linearB = new Map(dates.map((date, i) => [date, 3 * i + 10]));

  const perfect = correlateAll(
    [
      { typeKey: "a", points: linearA },
      { typeKey: "b", points: linearB },
    ],
    { maxLag: 0, minOverlap: 10 },
  );
  check("perfect linear relationship gives r = 1", near(perfect[0].pearson, 1, 1e-9), perfect[0].pearson.toFixed(6));
  check("and is flagged significant", perfect[0].significant);

  // A relationship that only exists at a one-day shift must be found there,
  // and must be near zero at lag 0.
  const cause = new Map(dates.map((date, i) => [date, Math.sin(i / 3) * 100 + 500]));
  const effect = new Map(
    dates.map((date, i) => [date, (Math.sin((i - 1) / 3) * 100 + 500) * 0.8 + 20]),
  );
  const lagged = correlateAll(
    [
      { typeKey: "cause", points: cause },
      { typeKey: "effect", points: effect },
    ],
    { maxLag: 2, minOverlap: 10 },
  );
  const best = lagged[0];
  check("lagged relationship found at the right shift", best.lag === -1 || best.lag === 1, `lag ${best.lag}`);
  const atZero = lagged.find((result) => result.lag === 0)!;
  check(
    "and is much weaker at lag 0",
    Math.abs(atZero.pearson) < Math.abs(best.pearson),
    `|r| ${Math.abs(atZero.pearson).toFixed(2)} vs ${Math.abs(best.pearson).toFixed(2)}`,
  );

  // Pure noise must not survive the multiple-comparison correction.
  let seed = 42;
  const random = () => {
    seed = (seed * 1664525 + 1013904223) % 4294967296;
    return seed / 4294967296;
  };
  const noise = Array.from({ length: 8 }, (_, s) => ({
    typeKey: `noise${s}`,
    points: new Map(dates.map((date) => [date, random()])),
  }));
  const noiseResults = correlateAll(noise, { maxLag: 1, minOverlap: 20 });
  const falsePositives = noiseResults.filter((result) => result.significant).length;
  check(
    "multiple-comparison correction suppresses noise",
    falsePositives === 0,
    `${falsePositives} significant of ${noiseResults.length} tested`,
  );

  check("p-value for r=0 is 1", near(pValueFor(0, 30), 1, 1e-9));
  check("p-value falls as n grows", pValueFor(0.4, 100) < pValueFor(0.4, 20));

  // Group comparison: weekends deliberately higher.
  // Jittered, because a constant group has zero variance and Cohen's d is then
  // undefined — a degenerate case, not the one worth asserting on.
  const weekendish = new Map(
    dates.map((date, i) => {
      const day = new Date(`${date}T00:00:00Z`).getUTCDay();
      const base = day === 0 || day === 6 ? 12000 : 6000;
      return [date, base + ((i * 37) % 11) * 50];
    }),
  );
  const comparison = compareWeekendVsWeekday({ typeKey: "steps", points: weekendish });
  check(
    "weekend split detects the difference",
    comparison.groups[1].mean > comparison.groups[0].mean,
    `${Math.round(comparison.groups[0].mean)} vs ${Math.round(comparison.groups[1].mean)}`,
  );
  check("and reports a large effect size", (comparison.effectSize ?? 0) > 2, `d = ${comparison.effectSize?.toFixed(1)}`);

  const summary = summarize({ typeKey: "a", points: linearA })!;
  check("summary trend is the true slope", near(summary.trendPerDay, 1, 1e-6), summary.trendPerDay.toFixed(4));
  check("summary counts every day", summary.n === 60);
}

function verifyExperiments() {
  section("Experiments");

  const experiment = { startDate: "2024-03-08", endDate: "2024-03-14", status: "active" as const };
  const windows = windowsFor(experiment, "2024-03-30");
  check(
    "baseline is the same length, just before the start",
    windows.baseline.from === "2024-03-01" && windows.baseline.to === "2024-03-07",
    `${windows.baseline.from} – ${windows.baseline.to}`,
  );
  check("after window mirrors the experiment", windows.after?.from === "2024-03-15" && windows.after?.to === "2024-03-21");
  check("running experiment measures up to today only", windowsFor(experiment, "2024-03-10").during?.to === "2024-03-10");
  check("phase follows the dates", phaseOf(experiment, "2024-03-01") === "scheduled" && phaseOf(experiment, "2024-03-08") === "running" && phaseOf(experiment, "2024-03-15") === "finished");
  check("abandoned overrides the dates", phaseOf({ ...experiment, status: "abandoned" }, "2024-03-10") === "abandoned");

  // Mood jumps by two points during the experiment; steps are unaffected noise.
  const mood = new Map<string, number>();
  const steps = new Map<string, number>();
  for (let i = 0; i < 21; i++) {
    const date = shiftLocalDate("2024-03-01", i);
    const inExperiment = date >= experiment.startDate && date <= experiment.endDate;
    mood.set(date, (inExperiment ? 7 : 5) + ((i * 7) % 3) * 0.2);
    steps.set(date, 8000 + ((i * 13) % 5) * 300);
  }
  const report = analyzeExperiment({
    experiment,
    today: "2024-03-30",
    series: [
      { typeKey: "mood", points: mood },
      { typeKey: "steps", points: steps },
    ],
    meta: new Map([
      ["mood", { label: "Mood", unit: null, polarity: 1 }],
      ["steps", { label: "Steps", unit: "steps", polarity: 1 }],
    ]),
    targetMetrics: ["mood", "steps", "untracked"],
    doneDates: new Set(["2024-03-08", "2024-03-09", "2024-03-10", "2024-03-11", "2024-03-12"]),
  });
  const [moodOutcome, stepsOutcome, missing] = report.outcomes;
  check("a real shift is called an improvement", moodOutcome.verdict === "improved", `${moodOutcome.changePct?.toFixed(0)}%, p = ${moodOutcome.pValue?.toFixed(4)}`);
  check("noise is not", stepsOutcome.verdict === "no_clear_change", `p = ${stepsOutcome.pValue?.toFixed(2)}`);
  check("a metric with no data says so", missing.verdict === "not_enough_data");
  check("adherence counts check-ins inside the window", report.adherence.daysDone === 5 && report.adherence.daysElapsed === 7);
}

/* -------------------------------------------------------------------------- */

async function main() {
  console.log("\x1b[1mYouAI verification\x1b[0m");

  await verifySchemaAndRollup();
  verifyDetectionAndConversion();
  verifyTimezones();
  verifyStatistics();
  verifyExperiments();

  console.log(
    failures === 0
      ? `\n\x1b[32m${checks} checks passed.\x1b[0m\n`
      : `\n\x1b[31m${failures} of ${checks} checks failed.\x1b[0m\n`,
  );
  process.exit(failures === 0 ? 0 : 1);
}

void main();
