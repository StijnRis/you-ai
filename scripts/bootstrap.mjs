#!/usr/bin/env node
/**
 * One-time setup for a fresh clone:  pnpm bootstrap
 *
 * Checks the toolchain, installs dependencies and creates the local config
 * files that are not committed. Safe to re-run; it never overwrites a file.
 */
import { execSync } from "node:child_process";
import { copyFileSync, existsSync } from "node:fs";

const step = (message) => console.log(`\n\x1b[1m▸ ${message}\x1b[0m`);
const fail = (message) => {
  console.error(`\x1b[31m✗ ${message}\x1b[0m`);
  process.exit(1);
};

step("Checking toolchain");
const nodeMajor = Number(process.versions.node.split(".")[0]);
if (nodeMajor < 24) fail(`Node 24+ is required (found ${process.versions.node}).`);
console.log(`  node ${process.versions.node}`);
try {
  console.log(`  pnpm ${execSync("pnpm --version").toString().trim()}`);
} catch {
  fail("pnpm is not installed: https://pnpm.io/installation");
}

step("Installing dependencies");
execSync("pnpm install", { stdio: "inherit" });

step("Creating local config");
const copies = [["apps/auth-worker/.dev.vars.example", "apps/auth-worker/.dev.vars"]];
for (const [from, to] of copies) {
  if (existsSync(to)) {
    console.log(`  ${to} exists, left alone`);
  } else {
    copyFileSync(from, to);
    console.log(`  created ${to} (fill in GitHub OAuth values to test "Connect GitHub")`);
  }
}

step("Done. Next:");
console.log(`  pnpm --filter @youai/auth-worker dev   # worker on http://localhost:8787
  pnpm --filter @youai/mobile web        # app in the browser
  pnpm --filter @youai/mobile android    # or ios, via Expo Go
  pnpm check                             # typecheck + lint + tests

  Add your own Nebius key in the app under More → Settings to use the AI features.`);
