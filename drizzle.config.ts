import { defineConfig } from "drizzle-kit";
import { config } from "dotenv";

config({ path: [".env.local", ".env"], quiet: true });

export default defineConfig({
  schema: "./lib/db/schema.ts",
  out: "./drizzle",
  dialect: "postgresql",
  dbCredentials: { url: process.env.DATABASE_URL! },
  casing: "snake_case",
  verbose: true,
  strict: true,
});
