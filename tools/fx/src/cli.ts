#!/usr/bin/env node
// fx: the factory CLI. Run it as `pnpm fx <command>` from the repo root.

import { run } from "./run.ts";

// `pnpm fx` runs from the repo root; INIT_CWD is where the person typed it.
process.exitCode = await run(
  process.argv.slice(2),
  process.env.INIT_CWD ?? process.cwd()
);
