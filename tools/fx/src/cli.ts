#!/usr/bin/env node
// fx: the factory CLI. Run it as `pnpm fx <command>` from the repo root.

import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";

import { run } from "./run.ts";

const cwd = process.env.INIT_CWD ?? process.cwd();

// Load the main checkout's .env (DATABASE_ADMIN_URL and friends). Values
// already in the environment win.
try {
  const commonDir = execFileSync(
    "git",
    ["rev-parse", "--path-format=absolute", "--git-common-dir"],
    { cwd, encoding: "utf-8", stdio: ["ignore", "pipe", "ignore"] }
  ).trim();
  const envFile = path.join(path.dirname(commonDir), ".env");
  if (existsSync(envFile)) {
    process.loadEnvFile(envFile);
  }
} catch {
  // Not in a repo: fx reports that itself.
}

// `pnpm fx` runs from the repo root; INIT_CWD is where the person typed it.
process.exitCode = await run(
  process.argv.slice(2),
  process.env.INIT_CWD ?? process.cwd()
);
