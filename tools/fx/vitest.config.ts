import shared from "@workspace/testing/vitest";
import { defineConfig, mergeConfig } from "vitest/config";

// fx tests drive real git. Alongside the rest of the suite that can take
// longer than the shared 15s, so this package allows 30s.
export default mergeConfig(
  shared,
  defineConfig({
    test: { testTimeout: 30_000 },
  })
);
