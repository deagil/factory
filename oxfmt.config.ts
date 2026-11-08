import { defineConfig } from "oxfmt";
import ultracite from "ultracite/oxfmt";

export default defineConfig({
  ...ultracite,
  // drizzle-kit writes these and rewrites the journal on every generate, so
  // they stay in its format.
  ignorePatterns: [
    ...ultracite.ignorePatterns,
    "packages/db/migrations/**",
    // Each system's own migrations (decision 0036).
    "*/*/migrations/**",
  ],
  sortTailwindcss: {
    ...ultracite.sortTailwindcss,
    stylesheet: "./packages/ui/src/styles/globals.css",
  },
});
