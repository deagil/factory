// The state of open changes, kept in `.fx/changes/<slug>.json` in the main
// checkout (gitignored). Worktrees find it through git's common directory.

import {
  mkdir,
  readdir,
  readFile,
  rename,
  rm,
  writeFile,
} from "node:fs/promises";
import path from "node:path";

import { FxError } from "./errors.ts";

export interface CheckResult {
  readonly passed: boolean;
  /** ISO timestamp. */
  readonly at: string;
  /** The commit the checks ran on. */
  readonly commit: string;
}

export interface Change {
  /** What the person typed: "deal pipeline". */
  readonly name: string;
  /** URL- and branch-safe form: "deal-pipeline". */
  readonly slug: string;
  readonly branch: string;
  /** Absolute path of the change's worktree. */
  readonly worktree: string;
  readonly database: string;
  /** ISO timestamp. */
  readonly createdAt: string;
  readonly lastCheck: CheckResult | null;
}

const changesDir = (stateDir: string) => path.join(stateDir, "changes");
const changeFile = (stateDir: string, slug: string) =>
  path.join(changesDir(stateDir), `${slug}.json`);

const isString = (value: unknown): value is string =>
  typeof value === "string" && value.length > 0;

const parseCheck = (value: unknown): CheckResult | null | undefined => {
  if (value === null) {
    return null;
  }
  if (typeof value !== "object") {
    return undefined;
  }
  const check = value as Record<string, unknown>;
  if (
    typeof check.passed === "boolean" &&
    isString(check.at) &&
    isString(check.commit)
  ) {
    return { passed: check.passed, at: check.at, commit: check.commit };
  }
  return undefined;
};

/** Validates a parsed state file. Returns undefined if it isn't a change. */
export const parseChange = (value: unknown): Change | undefined => {
  if (typeof value !== "object" || value === null) {
    return undefined;
  }
  const raw = value as Record<string, unknown>;
  const lastCheck = parseCheck(raw.lastCheck ?? null);
  const fields = [
    raw.name,
    raw.slug,
    raw.branch,
    raw.worktree,
    raw.database,
    raw.createdAt,
  ];
  if (!fields.every(isString) || lastCheck === undefined) {
    return undefined;
  }
  return {
    name: raw.name as string,
    slug: raw.slug as string,
    branch: raw.branch as string,
    worktree: raw.worktree as string,
    database: raw.database as string,
    createdAt: raw.createdAt as string,
    lastCheck,
  };
};

/** Reads one change file; undefined if it doesn't exist. */
const readChange = async (file: string): Promise<Change | undefined> => {
  let text: string;
  try {
    text = await readFile(file, "utf-8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return undefined;
    }
    throw error;
  }
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    throw new FxError(
      "state_invalid",
      `${file} is not valid JSON.`,
      "Fix or delete the file."
    );
  }
  const change = parseChange(value);
  if (!change) {
    throw new FxError(
      "state_invalid",
      `${file} is not a valid change.`,
      "Fix or delete the file."
    );
  }
  return change;
};

/** Every open change, oldest first. */
export const listChanges = async (stateDir: string): Promise<Change[]> => {
  let files: string[];
  try {
    files = await readdir(changesDir(stateDir));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return [];
    }
    throw error;
  }
  const changes = await Promise.all(
    files
      .filter((file) => file.endsWith(".json"))
      .map((file) => readChange(path.join(changesDir(stateDir), file)))
  );
  return changes
    .filter((change): change is Change => change !== undefined)
    .toSorted((a, b) => a.createdAt.localeCompare(b.createdAt));
};

/** The change with this slug, or undefined. */
export const findChange = (
  stateDir: string,
  slug: string
): Promise<Change | undefined> => readChange(changeFile(stateDir, slug));

/** Writes a change atomically: a crash never leaves half a file. */
export const saveChange = async (
  stateDir: string,
  change: Change
): Promise<void> => {
  await mkdir(changesDir(stateDir), { recursive: true });
  const file = changeFile(stateDir, change.slug);
  const temporary = `${file}.${process.pid}.tmp`;
  await writeFile(temporary, `${JSON.stringify(change, null, 2)}\n`);
  await rename(temporary, file);
};

export const removeChange = async (
  stateDir: string,
  slug: string
): Promise<void> => {
  await rm(changeFile(stateDir, slug), { force: true });
};

/** The change whose worktree contains `cwd`, if any. */
export const changeForPath = (
  changes: readonly Change[],
  cwd: string
): Change | undefined =>
  changes.find(
    (change) =>
      cwd === change.worktree || cwd.startsWith(`${change.worktree}${path.sep}`)
  );
