// `config:validate [system-dir]`: runs validateConfig on a system package's
// `config/`. The package's package.json names its system file
// (`factory.system`); the system's `config` option names the folder.
import { readFileSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { ConfigError, formatProblem } from "@workspace/config";

import type { System } from "../system.ts";

const dir = path.resolve(process.argv[2] ?? ".");
const manifest = JSON.parse(
  readFileSync(path.join(dir, "package.json"), "utf-8")
) as { factory?: { system?: string } };
const systemFile = manifest.factory?.system;
if (!systemFile) {
  throw new Error(`${dir}/package.json has no factory.system.`);
}

let problems: string[];
let checked = 0;
try {
  const { default: system } = (await import(
    pathToFileURL(path.resolve(dir, systemFile)).href
  )) as { default: System };
  const read = system.validateConfig();
  checked = read.files.length;
  problems = read.problems.map((problem) => formatProblem(problem));
} catch (error) {
  // The system reads some config as it loads (its roles).
  if (!(error instanceof ConfigError)) {
    throw error;
  }
  problems = error.problems.map((problem) => formatProblem(problem));
}

if (problems.length > 0) {
  process.stderr.write(
    `Config has ${problems.length} problem(s):\n${problems.map((line) => `  ${line}`).join("\n")}\n`
  );
  process.exitCode = 1;
} else {
  process.stdout.write(`Checked ${checked} config file(s): no problems.\n`);
}
