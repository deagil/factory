import { parseArgs } from "node:util";
import type { ParseArgsOptionsConfig } from "node:util";

import { FxError } from "./errors.ts";

interface CommandSpec {
  readonly summary: string;
  readonly usage: string;
  readonly options: ParseArgsOptionsConfig;
  /** How many positional arguments the command takes. */
  readonly positionals: { readonly min: number; readonly max: number };
}

/** Options every command accepts. */
const globalOptions = {
  json: { type: "boolean", default: false },
  help: { type: "boolean", short: "h", default: false },
} as const satisfies ParseArgsOptionsConfig;

export const commands = {
  status: {
    summary:
      "Show the current change, its branch and database, and its last checks",
    usage: "fx status [--json]",
    options: {},
    positionals: { min: 0, max: 0 },
  },
  start: {
    summary:
      "Start a change: branch, worktree, database and .env, all in one step",
    usage: 'fx start "<name>" [--json]',
    options: { "skip-install": { type: "boolean", default: false } },
    positionals: { min: 1, max: 1 },
  },
  dev: {
    summary:
      "Run the dev servers on the change's database, pushing schema edits to it as you save",
    usage: "fx dev [--reset] [--json]",
    options: { reset: { type: "boolean", default: false } },
    positionals: { min: 0, max: 0 },
  },
  ship: {
    summary:
      "Rebase on main, write the change's one migration, run every check, then push and open a PR",
    usage: 'fx ship [--contract-step "<why it is safe now>"] [--json]',
    options: { "contract-step": { type: "string" } },
    positionals: { min: 0, max: 0 },
  },
  switch: {
    summary: "Say where another change's worktree is, to cd into",
    usage: "fx switch <name> [--path] [--json]",
    options: { path: { type: "boolean", default: false } },
    positionals: { min: 1, max: 1 },
  },
  done: {
    summary:
      "Remove a merged change's worktree, branch and database, and its .fx entry",
    usage: "fx done [<name>] [--force] [--json]",
    options: { force: { type: "boolean", default: false } },
    positionals: { min: 0, max: 1 },
  },
} as const satisfies Record<string, CommandSpec>;

export type CommandName = keyof typeof commands;

export interface ParsedArgs {
  readonly command: CommandName | undefined;
  readonly positionals: readonly string[];
  readonly options: Readonly<
    Record<string, string | boolean | (string | boolean)[] | undefined>
  >;
  readonly json: boolean;
  readonly help: boolean;
}

const isCommand = (name: string): name is CommandName =>
  Object.hasOwn(commands, name);

const parse = (
  argv: readonly string[],
  options: ParseArgsOptionsConfig,
  usage: string
) => {
  try {
    return parseArgs({
      args: [...argv],
      options,
      allowPositionals: true,
      strict: true,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new FxError("usage", message, `Usage: ${usage}`);
  }
};

/**
 * Parses `fx <command> [args] [options]`. With no command, or with `--help`,
 * `help` is true. Throws a usage FxError for unknown commands or options.
 */
export const parseCliArgs = (argv: readonly string[]): ParsedArgs => {
  const [first, ...rest] = argv;
  if (first === undefined || first.startsWith("-")) {
    const { values } = parse(argv, globalOptions, "fx");
    return {
      command: undefined,
      positionals: [],
      options: {},
      json: values.json === true,
      help: true,
    };
  }
  if (!isCommand(first)) {
    throw new FxError(
      "usage",
      `Unknown command "${first}".`,
      `Run \`fx --help\` to see the commands.`
    );
  }
  const spec: CommandSpec = commands[first];
  const { values, positionals } = parse(
    rest,
    { ...globalOptions, ...spec.options },
    spec.usage
  );
  const { json, help, ...options } = values;
  if (
    help !== true &&
    (positionals.length < spec.positionals.min ||
      positionals.length > spec.positionals.max)
  ) {
    throw new FxError(
      "usage",
      `Wrong number of arguments for "${first}".`,
      `Usage: ${spec.usage}`
    );
  }
  return {
    command: first,
    positionals,
    options,
    json: json === true,
    help: help === true,
  };
};

/** Help text for one command, or for fx as a whole. */
export const helpText = (command?: CommandName): string => {
  if (command) {
    const spec = commands[command];
    return `${spec.summary}.\n\nUsage: ${spec.usage}\n`;
  }
  const lines = Object.entries(commands).map(
    ([name, spec]) => `  ${name.padEnd(10)}${spec.summary}`
  );
  return `fx: the factory CLI. Every command takes --json.\n\nCommands:\n${lines.join("\n")}\n\nRun \`fx <command> --help\` for details.\n`;
};
