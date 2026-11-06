// Reading drizzle-kit's output. drizzle-kit exits 0 even when it fails, so
// fx decides from what it prints and the files it writes.

import path from "node:path";

import { plainText } from "./process.ts";

/** The Drizzle package in a worktree: where drizzle-kit runs. */
export const dbPackageDir = (worktree: string): string =>
  path.join(worktree, "packages", "db");

/**
 * True when drizzle-kit stopped because it wanted to ask a question (is this
 * table or column renamed, or dropped and another added?) and had no
 * terminal to ask on.
 */
export const wantedToAsk = (output: string): boolean =>
  plainText(output).includes("Interactive prompts require a TTY");

/** What fx says when drizzle-kit wanted to ask about a rename. */
export const renameQuestion =
  "drizzle-kit can't tell whether a table or column was renamed, or dropped and another added, without asking, and it can only ask in a terminal.";
