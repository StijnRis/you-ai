/**
 * Dry-run an export without a database.
 *
 * Runs every file in a folder through the real pipeline — detect the format,
 * pick a conversion, apply it — and prints what would be stored. Nothing is
 * written anywhere, so this is the fastest way to check a new export or a
 * changed conversion.
 *
 *   pnpm import:dry-run "example data"
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { detectFile, scoreSpec } from "@/lib/mapping/detect";
import { builtinSpecs, ignoreReasonFor } from "@/lib/mapping/builtin";
import { applySpecToRecords } from "@/lib/mapping/apply";
import { readRecords } from "@/lib/readers";

const dir = process.argv[2] ?? "example data";
const TZ = "Europe/Amsterdam";

const totals = new Map<string, { events: number; days: Set<string>; min: number; max: number }>();
const unmatched: string[] = [];
let ignored = 0;

for (const name of readdirSync(dir).sort()) {
  const path = join(dir, name);
  if (!statSync(path).isFile()) continue;

  const reason = ignoreReasonFor(name);
  if (reason) {
    ignored++;
    console.log(`\x1b[2m— ${name}\n    skipped: ${reason}\x1b[0m`);
    continue;
  }

  const buf = readFileSync(path);
  const detection = detectFile({ path: name, text: buf.toString("utf8"), bytes: buf.length });

  let best: (typeof builtinSpecs)[number] | null = null;
  let bestScore = 0;
  for (const spec of builtinSpecs) {
    const score = scoreSpec(spec, detection, name);
    if (score > bestScore) {
      best = spec;
      bestScore = score;
    }
  }

  if (!best) {
    unmatched.push(`${name} (${detection.recordCount} records, ${detection.fields.length} fields)`);
    console.log(`\x1b[31m✗ ${name}\x1b[0m — no built-in matched`);
    continue;
  }

  const records = readRecords(buf.toString("utf8"), best.reader);
  const applied = applySpecToRecords(records, best, { timezone: TZ });

  const byType = new Map<string, number>();
  for (const e of applied.events) {
    byType.set(e.typeKey, (byType.get(e.typeKey) ?? 0) + 1);
    const t = totals.get(e.typeKey) ?? { events: 0, days: new Set<string>(), min: Infinity, max: -Infinity };
    t.events++;
    t.days.add(e.localDate);
    if (e.value !== null) {
      t.min = Math.min(t.min, e.value);
      t.max = Math.max(t.max, e.value);
    }
    totals.set(e.typeKey, t);
  }

  const dates = applied.events.map((e) => e.localDate).sort();
  console.log(
    `\x1b[32m✓\x1b[0m ${name}\n    ${best.key} (score ${bestScore.toFixed(1)}) — ` +
      `${applied.recordsRead} records → ${applied.events.length} events` +
      (dates.length ? `, ${dates[0]}..${dates[dates.length - 1]}` : "") +
      (applied.errors.length ? `  \x1b[33m${applied.errors.length} errors: ${applied.errors[0].message}\x1b[0m` : ""),
  );
  console.log(
    `    ${[...byType].map(([k, v]) => `${k}=${v}`).join(" ") || "\x1b[33m(no events)\x1b[0m"}`,
  );
}

console.log(`\n\x1b[1mSeries produced\x1b[0m  (${ignored} files skipped by design)`);
for (const [key, t] of [...totals].sort()) {
  console.log(
    `  ${key.padEnd(26)} ${String(t.events).padStart(7)} events  ${String(t.days.size).padStart(5)} days  ` +
      `range ${t.min === Infinity ? "—" : t.min.toFixed(1)}..${t.max === -Infinity ? "—" : t.max.toFixed(1)}`,
  );
}
if (unmatched.length) {
  console.log(`\n\x1b[31mUnmatched (${unmatched.length}):\x1b[0m`);
  for (const u of unmatched) console.log(`  ${u}`);
}
