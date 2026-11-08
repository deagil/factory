import { existsSync } from "node:fs";
import path from "node:path";

import { defineConfig } from "vitest/config";

// Load the `.env` at the root of the repo or worktree. Values already in the
// environment (CI, fx) win.
const envFile = path.resolve(import.meta.dirname, "../../../.env");
if (existsSync(envFile)) {
  process.loadEnvFile(envFile);
}

// Tests never touch the dev database: they get their own from
// createTestDatabase(), which uses DATABASE_ADMIN_URL. Removing DATABASE_URL
// makes anything that reaches for it fail loudly instead.
delete process.env.DATABASE_URL;

/**
 * The shared Vitest config. Each package's `vitest.config.ts` re-exports it,
 * so every package runs tests the same way.
 */
export default defineConfig({
  resolve: { tsconfigPaths: true },
  test: {
    include: ["src/**/*.test.{ts,tsx}"],
    globalSetup: [path.resolve(import.meta.dirname, "global-setup.ts")],
    restoreMocks: true,
    // Every package's tests run at once, each making databases from
    // migrations on one Postgres, so on CI a hook that takes 1s alone can
    // take over 10s. Tests that are slow on purpose still set their own.
    hookTimeout: 30_000,
    testTimeout: 15_000,
  },
});
