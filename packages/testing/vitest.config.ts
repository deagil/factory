import { defineConfig, mergeConfig } from "vitest/config";

import shared from "./src/vitest.ts";

export default mergeConfig(
  shared,
  defineConfig({
    // The isolation tests need two files running at once. CI runners for
    // private repos have two CPUs, where Vitest would default to one worker.
    test: { maxWorkers: 2 },
  })
);
