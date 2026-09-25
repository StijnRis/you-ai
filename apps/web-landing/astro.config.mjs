import { defineConfig } from "astro/config";

// Fully static: `astro build` emits dist/, which Cloudflare Pages serves as-is.
export default defineConfig({
  site: "https://youai.pages.dev",
  output: "static",
});
