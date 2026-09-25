import { defineConfig, devices } from "@playwright/test";

/**
 * End-to-end tests against the exported web build (`pnpm build` first).
 * Served by `wrangler pages dev` so the production `public/_headers` apply —
 * expo-sqlite on web needs their cross-origin isolation.
 *
 * Uses the Chrome already installed on the machine (GitHub runners have it),
 * so there is no browser download. Every test gets a fresh browser context,
 * which means a fresh, empty on-device database.
 */
export default defineConfig({
  testDir: "./e2e",
  timeout: 60_000,
  expect: { timeout: 20_000 },
  fullyParallel: true,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [["github"], ["html", { open: "never" }]] : "list",
  use: {
    baseURL: "http://localhost:8788",
    trace: "retain-on-failure",
  },
  projects: [{ name: "chrome", use: { ...devices["Pixel 7"], channel: "chrome" } }],
  webServer: {
    command: "pnpm exec wrangler pages dev dist --port 8788",
    url: "http://localhost:8788",
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
});
