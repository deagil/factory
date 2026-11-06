import { existsSync } from "node:fs";
import { copyFile, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import {
  createDatabaseFromTemplate,
  databaseUrl,
  dropDatabase,
  ensureTemplateDatabase,
  listDatabases,
  withAdmin,
} from "@workspace/testing/databases";

import { requireAdminUrl } from "../admin.ts";
import { setEnvValue } from "../env-file.ts";
import { FxError } from "../errors.ts";
import { findRepo, git, hasOrigin } from "../git.ts";
import type { Repo } from "../git.ts";
import { branchName, databaseName, slugify } from "../names.ts";
import { capture, errorLine, plainText } from "../process.ts";
import { findChange, saveChange } from "../state.ts";
import type { Change } from "../state.ts";

export interface StartOptions {
  /** Skip `pnpm install` in the new worktree (tests only). */
  readonly skipInstall?: boolean;
  /** Where progress goes; stderr by default, so stdout stays clean for --json. */
  readonly log?: (line: string) => void;
}

/** The folder holding a repo's change worktrees: `../<repo>.worktrees`. */
export const worktreesRoot = (repo: Repo): string =>
  path.join(path.dirname(repo.mainRoot), `${repo.name}.worktrees`);

const assertClean = async (worktreeRoot: string): Promise<void> => {
  const changes = await git(worktreeRoot, "status", "--porcelain");
  if (changes !== "") {
    const files = changes.split("\n").slice(0, 5).join("\n  ");
    throw new FxError(
      "dirty_worktree",
      `${worktreeRoot} has uncommitted changes:\n  ${files}`,
      "Commit them, or stash them with `git stash -u`, then run fx start again."
    );
  }
};

const branchExists = async (repo: Repo, branch: string): Promise<boolean> => {
  const found = await git(repo.mainRoot, "branch", "--list", branch);
  return found !== "";
};

const assertNew = async (
  repo: Repo,
  slug: string,
  branch: string,
  worktree: string,
  database: string,
  adminUrl: string
): Promise<void> => {
  const hint = `Pick another name, run \`fx switch ${slug}\`, or remove it with \`fx done ${slug}\`.`;
  if (await findChange(repo.stateDir, slug)) {
    throw new FxError(
      "change_exists",
      `A change called "${slug}" is already open.`,
      hint
    );
  }
  if (await branchExists(repo, branch)) {
    throw new FxError(
      "change_exists",
      `Branch ${branch} already exists.`,
      hint
    );
  }
  if (existsSync(worktree)) {
    throw new FxError("change_exists", `${worktree} already exists.`, hint);
  }
  const databases = await withAdmin(
    (client) => listDatabases(client, database),
    adminUrl
  );
  if (databases.includes(database)) {
    throw new FxError(
      "change_exists",
      `Database ${database} already exists.`,
      hint
    );
  }
};

/** Runs `pnpm install` in the worktree. Its output is shown only if it fails. */
const install = async (cwd: string): Promise<void> => {
  const result = await capture("pnpm", ["install", "--frozen-lockfile"], {
    cwd,
  });
  if (result.code !== 0) {
    const output = plainText(`${result.stdout}\n${result.stderr}`);
    throw new FxError(
      "command_failed",
      `pnpm install failed in ${cwd} (exit ${result.code}): ${errorLine(output)}`,
      "Fix the install, then run `pnpm install` in the worktree."
    );
  }
};

/** Runs undo steps in order, carrying on even if one fails. */
const runUndo = async (
  steps: readonly (() => Promise<unknown>)[]
): Promise<void> => {
  const [step, ...rest] = steps;
  if (!step) {
    return;
  }
  await Promise.allSettled([step()]);
  await runUndo(rest);
};

/** Writes the worktree's `.env`: the main checkout's (or the example), pointed at the change's database. */
const writeEnv = async (
  repo: Repo,
  worktree: string,
  url: string
): Promise<void> => {
  const source = [
    path.join(repo.mainRoot, ".env"),
    path.join(worktree, ".env.example"),
  ].find((file) => existsSync(file));
  const target = path.join(worktree, ".env");
  if (source) {
    await copyFile(source, target);
  }
  const text = existsSync(target) ? await readFile(target, "utf-8") : "";
  await writeFile(target, setEnvValue(text, "DATABASE_URL", url));
};

/**
 * `fx start "<name>"`: a branch from an up-to-date main, a worktree, a
 * database cloned from the migrated template, the worktree's `.env`, and an
 * entry in `.fx/`. Undoes what it did if a step fails.
 */
export const start = async (
  cwd: string,
  name: string,
  options: StartOptions = {}
): Promise<Change> => {
  const log =
    options.log ?? ((line: string) => process.stderr.write(`${line}\n`));
  const repo = await findRepo(cwd);
  const adminUrl = requireAdminUrl();
  const slug = slugify(name);
  const branch = branchName(slug);
  const worktree = path.join(worktreesRoot(repo), slug);
  const database = databaseName(repo.name, slug);

  await assertClean(repo.worktreeRoot);
  await assertNew(repo, slug, branch, worktree, database, adminUrl);

  const undo: (() => Promise<unknown>)[] = [];
  try {
    let base = "main";
    if (await hasOrigin(repo.mainRoot)) {
      log("Fetching origin/main…");
      await git(repo.mainRoot, "fetch", "--quiet", "origin", "main");
      base = "origin/main";
    }

    log(`Creating ${branch} from ${base} in ${worktree}…`);
    await git(
      repo.mainRoot,
      "worktree",
      "add",
      "--quiet",
      "--no-track",
      "-b",
      branch,
      worktree,
      base
    );
    undo.push(
      () => git(repo.mainRoot, "branch", "-D", branch),
      () => git(repo.mainRoot, "worktree", "remove", "--force", worktree)
    );

    log(`Creating database ${database} from the migrated template…`);
    const template = await ensureTemplateDatabase(
      path.join(worktree, "packages", "db", "migrations"),
      adminUrl
    );
    await withAdmin(
      (client) => createDatabaseFromTemplate(client, database, template),
      adminUrl
    );
    undo.push(() =>
      withAdmin((client) => dropDatabase(client, database), adminUrl)
    );

    await writeEnv(repo, worktree, databaseUrl(adminUrl, database));

    if (!options.skipInstall) {
      log("Installing dependencies…");
      await install(worktree);
    }

    const change: Change = {
      name,
      slug,
      branch,
      worktree,
      database,
      createdAt: new Date().toISOString(),
      lastCheck: null,
    };
    await saveChange(repo.stateDir, change);
    return change;
  } catch (error) {
    log("Something failed; undoing what fx start did…");
    await runUndo(undo.toReversed());
    throw error;
  }
};

/** The human-readable result of `fx start`. */
export const formatStart = (change: Change, from: string): string =>
  [
    `Started "${change.name}".`,
    `  branch    ${change.branch}`,
    `  worktree  ${change.worktree}`,
    `  database  ${change.database}`,
    "",
    "Next:",
    `  cd ${path.relative(from, change.worktree) || "."}`,
    "  pnpm fx dev",
    "",
  ].join("\n");
