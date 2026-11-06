import { existsSync } from "node:fs";
import path from "node:path";

import { defineConfig } from "vitest/config";

// Load the `.env` at the root of the repo or worktree. Values already in the
// environment (CI, fx) win.
const envFile = path.resolve(import.meta.dirname, "../../../.env");
if (existsSync(envFile)) {
  process.loadEnvFile(envFile);
}

/**
 * The shared Vitest config. Each package's `vitest.config.ts` re-exports it,
 * so every package runs tests the same way.
 */
export default defineConfig({
  resolve: { tsconfigPaths: true },
  test: {
    include: ["src/**/*.test.{ts,tsx}"],
    restoreMocks: true,
  },
});
