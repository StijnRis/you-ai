import { defineConfig } from "drizzle-kit";

/** `driver: "expo"` emits a migrations.js bundle the app imports and runs on device. */
export default defineConfig({
  dialect: "sqlite",
  driver: "expo",
  schema: "./src/schema.ts",
  out: "./drizzle",
});
