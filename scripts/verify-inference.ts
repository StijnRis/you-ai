/**
 * Checks the one path `pnpm verify` cannot: the model writing a conversion for
 * a format it has never seen. Needs NEBIUS_API_KEY.
 *
 *   pnpm verify:inference
 */
import { config } from "dotenv";
config({ path: [".env.local", ".env"], quiet: true });

import { readFileSync } from "node:fs";
import { detectFile } from "@/lib/mapping/detect";
import { inferSpec } from "@/lib/mapping/infer";
import { CHAT_MODEL, REASONING_MODEL } from "@/lib/ai/provider";

async function main() {
  if (!process.env.NEBIUS_API_KEY) {
    console.error("NEBIUS_API_KEY is not set — nothing to check. See .env.example.");
    process.exit(1);
  }

  const path = process.argv[2] ?? "test/fixtures/unknown-mood.csv";
  const text = readFileSync(path, "utf8");
  const detection = detectFile({ path, text, bytes: text.length });

  console.log(`File:        ${path}`);
  console.log(`Format:      ${detection.format}`);
  console.log(`Fields:      ${detection.fields.join(", ")}`);
  console.log(`Fingerprint: ${detection.fingerprint}`);
  console.log(`Model:       ${REASONING_MODEL()} (chat uses ${CHAT_MODEL()})\n`);

  const started = Date.now();
  const result = await inferSpec(detection, { timezone: "Europe/Madrid" });
  const seconds = ((Date.now() - started) / 1000).toFixed(1);

  console.log(`Inferred in ${seconds}s after ${result.attempts} attempt(s):\n`);
  console.log(JSON.stringify(result.spec, null, 2));

  console.log(`\nDry run over ${result.preview.recordsRead} sample records:`);
  console.log(`  ${result.preview.events.length} events, ${result.preview.skipped} skipped`);
  for (const event of result.preview.events.slice(0, 8)) {
    console.log(
      `  ${event.localDate}  ${event.typeKey.padEnd(22)} ${event.value ?? event.valueText}`,
    );
  }

  if (result.preview.events.length === 0) {
    console.error("\nThe inferred conversion produced nothing. That is a failure.");
    process.exit(1);
  }
  process.exit(0);
}

void main();
