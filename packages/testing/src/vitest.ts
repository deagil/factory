import { defineConfig } from "vitest/config";

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
