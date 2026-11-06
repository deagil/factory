// Running other tools: pnpm, drizzle-kit, gh.

import { spawn } from "node:child_process";
import { once } from "node:events";
import { stripVTControlCharacters } from "node:util";

export interface Captured {
  /** The exit code, or null if a signal ended it. */
  readonly code: number | null;
  readonly stdout: string;
  readonly stderr: string;
}

export interface RunOptions {
  readonly cwd: string;
  readonly env?: NodeJS.ProcessEnv;
  /** Kill it after this long; the promise then rejects with an AbortError. */
  readonly timeoutMs?: number;
}

/**
 * Runs a command to the end and captures its output. Rejects only if it
 * can't start or times out; a non-zero exit resolves.
 */
export const capture = async (
  command: string,
  args: readonly string[],
  options: RunOptions
): Promise<Captured> => {
  const child = spawn(command, args, {
    cwd: options.cwd,
    env: options.env ?? process.env,
    stdio: ["ignore", "pipe", "pipe"],
    signal:
      options.timeoutMs === undefined
        ? undefined
        : AbortSignal.timeout(options.timeoutMs),
  });
  let stdout = "";
  let stderr = "";
  child.stdout.on("data", (chunk: Buffer) => {
    stdout += chunk.toString();
  });
  child.stderr.on("data", (chunk: Buffer) => {
    stderr += chunk.toString();
  });
  const [code] = (await once(child, "close")) as [number | null];
  return { code, stdout, stderr };
};

/**
 * Runs a command with its output on stderr, so stdout stays clean for
 * `--json`. Resolves with the exit code.
 */
export const runToStderr = async (
  command: string,
  args: readonly string[],
  options: RunOptions
): Promise<number | null> => {
  const child = spawn(command, args, {
    cwd: options.cwd,
    env: options.env ?? process.env,
    stdio: ["ignore", 2, 2],
  });
  const [code] = (await once(child, "exit")) as [number | null];
  return code;
};

/** A tool's output as plain text, without colours or spinners. */
export const plainText = (output: string): string =>
  stripVTControlCharacters(output);

/**
 * The line that best explains a tool's failure: the first that mentions an
 * error, or else the last.
 */
export const errorLine = (output: string): string => {
  const lines = plainText(output)
    .split(/[\r\n]+/u)
    .map((line) => line.trim())
    .filter((line) => line !== "");
  return (
    lines.find((line) => /error/iu.test(line)) ?? lines.at(-1) ?? "no output"
  );
};
