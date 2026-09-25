import js from "@eslint/js";
import tseslint from "typescript-eslint";

/** Shared flat config for plain TypeScript packages (core, db, worker). */
export default tseslint.config(
  { ignores: ["dist/**", "node_modules/**", ".wrangler/**", "drizzle/**"] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    rules: {
      "@typescript-eslint/no-unused-vars": ["warn", { argsIgnorePattern: "^_" }],
    },
  },
);
