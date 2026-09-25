import path from "node:path";
import { expect, test, type Page } from "@playwright/test";

const fixture = (name: string) => path.join(__dirname, "../../../test/fixtures", name);

async function connectSampleData(page: Page) {
  await page.goto("/sources");
  const card = page.getByText("Adds a year of made-up data").locator("..");
  await card.getByRole("button", { name: "Connect" }).click();
  // Once connected, the form is replaced by the source's own row.
  await expect(page.getByText(/[\d.,]+ records · last synced/)).toBeVisible();
}

test("a new install starts empty", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByText("No data yet")).toBeVisible();
});

test("sample data shows up on the dashboard and in insights", async ({ page }) => {
  await connectSampleData(page);

  await page.goto("/");
  await expect(page.getByText(/\d+ days of data/)).toBeVisible();
  await expect(page.getByText("Strongest patterns")).toBeVisible();

  await page.goto("/insights");
  await expect(page.getByText("Mood rises with Sleep")).toBeVisible();
});

test("data survives a reload", async ({ page }) => {
  await connectSampleData(page);
  await page.reload();
  await expect(page.getByText(/[\d.,]+ records · last synced/).first()).toBeVisible();
});

test("logging a mood adds a check-in", async ({ page }) => {
  await page.goto("/mood");
  await page.getByLabel(/^7 — /).click();
  await page.getByRole("button", { name: "Log mood" }).click();
  await expect(page.getByText("✓ Logged")).toBeVisible();
  await expect(page.getByText("Recent check-ins")).toBeVisible();
});

test("importing an export converts it on the device", async ({ page }) => {
  await page.goto("/import");
  const chooser = page.waitForEvent("filechooser");
  await page.getByRole("button", { name: "Choose files" }).click();
  await (await chooser).setFiles(fixture("google-fit-daily.csv"));

  await expect(page.getByText("Matched a conversion that ships with the app.")).toBeVisible();
  await expect(page.getByText(/Imported 1 file, storing \d+ events/)).toBeVisible();
});
