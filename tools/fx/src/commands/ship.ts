import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { databaseUrl } from "@workspace/testing/databases";

import { requireAdminUrl } from "../admin.ts";
import { dbPackageDir, renameQuestion, wantedToAsk } from "../drizzle.ts";
import { FxError } from "../errors.ts";
import { currentBranch, findRepo, git, hasOrigin } from "../git.ts";
import { ghInstalled, watchRemoteCheck } from "../github.ts";
import type { RemoteCheck } from "../github.ts";
import { capture, errorLine, plainText, runToStderr } from "../process.ts";
import { changeForPath, listChanges, saveChange } from "../state.ts";
import type { Change } from "../state.ts";
import { findSystems } from "./describe.ts";

/** The core's migrations folder, relative to the worktree. */
export const migrationsPath = path.join("packages", "db", "migrations");

/** Where drizzle-kit runs and the migrations folder it writes, relative to the worktree. */
export interface MigrationTarget {
  readonly dir: string;
  readonly migrations: string;
}

/**
 * The core's migrations, then each system's: a system package with a
 * drizzle.config.ts keeps its own in `<package>/migrations` (decision 0036).
 */
export const migrationTargets = async (
  worktree: string
): Promise<MigrationTarget[]> => {
  const systems = await findSystems(worktree);
  return [
    { dir: path.join("packages", "db"), migrations: migrationsPath },
    ...systems
      .filter((system) =>
        existsSync(path.join(worktree, system.dir, "drizzle.config.ts"))
      )
      .toSorted((a, b) => a.dir.localeCompare(b.dir))
      .map((system) => ({
        dir: system.dir,
        migrations: path.join(system.dir, "migrations"),
      })),
  ];
};

/** The trailer on the commit that holds the change's migration. */
export const migrationTrailer = "Fx-Migration";

const mainBranch = "main";

// ---------------------------------------------------------------------------
// Contract steps

const markerLine = /^--[ \t]*contract-step:[ \t]*(?<why>\S.*)$/u;

/** The reason on a migration's `-- contract-step:` first line, if it has one. */
export const contractReason = (sql: string): string | undefined =>
  markerLine.exec(sql.split("\n", 1)[0] ?? "")?.groups?.why?.trim();

/**
 * The migration with `-- contract-step: <why>` as its first line, replacing
 * any marker it had. With no reason, the marker is removed.
 */
export const withContractStep = (
  sql: string,
  why: string | undefined
): string => {
  let body = sql;
  if (contractReason(sql) !== undefined) {
    const newline = sql.indexOf("\n");
    body = newline === -1 ? "" : sql.slice(newline + 1);
  }
  return why ? `-- contract-step: ${why}\n${body}` : body;
};

// ---------------------------------------------------------------------------
// History

/** Commits since `base` that hold this change's migration, newest first. */
export const migrationCommits = async (
  worktree: string,
  base: string,
  slug: string
): Promise<string[]> => {
  const shas = await git(
    worktree,
    "log",
    "--format=%H",
    `--grep=^${migrationTrailer}: ${slug}$`,
    `${base}..HEAD`
  );
  return shas === "" ? [] : shas.split("\n");
};

/** The contract-step reason in the migrations a commit added, if any. */
const commitContractReason = async (
  worktree: string,
  sha: string
): Promise<string | undefined> => {
  const files = await git(
    worktree,
    "show",
    "--format=",
    "--name-only",
    "--diff-filter=A",
    sha
  );
  const sqlFile = files.split("\n").find((file) => file.endsWith(".sql"));
  return sqlFile
    ? contractReason(await git(worktree, "show", `${sha}:${sqlFile}`))
    : undefined;
};

const abortRebase = async (worktree: string): Promise<void> => {
  await Promise.allSettled([git(worktree, "rebase", "--abort")]);
};

/**
 * Removes the change's migration commits from the branch, replaying later
 * commits without them. Returns the newest one's contract-step reason.
 */
export const dropMigrationCommits = async (
  worktree: string,
  base: string,
  slug: string,
  reason?: string
): Promise<string | undefined> => {
  const [newest] = await migrationCommits(worktree, base, slug);
  if (!newest) {
    return reason;
  }
  const kept = reason ?? (await commitContractReason(worktree, newest));
  try {
    await git(worktree, "rebase", "--quiet", "--onto", `${newest}^`, newest);
  } catch {
    await abortRebase(worktree);
    throw new FxError(
      "rebase_conflict",
      "Commits after the change's migration commit also edit the migration, so fx ship can't replace it.",
      "Undo those edits to the migrations, commit, and run fx ship again. fx ship writes the migrations from the schema."
    );
  }
  return await dropMigrationCommits(worktree, base, slug, kept);
};

/** Rebases the branch on `base`, aborting if it conflicts. */
export const rebaseOn = async (
  worktree: string,
  base: string
): Promise<void> => {
  try {
    await git(worktree, "rebase", "--quiet", base);
  } catch {
    await abortRebase(worktree);
    throw new FxError(
      "rebase_conflict",
      `Rebasing on ${base} hit conflicts, so fx ship stopped and left the branch as it was.`,
      `Run \`git rebase ${base}\`, resolve the conflicts, run \`git rebase --continue\`, then fx ship again.`
    );
  }
};

/** Files under the migrations folders that differ from `base`. */
const editedMigrations = async (
  worktree: string,
  base: string,
  folders: readonly string[]
): Promise<string[]> => {
  const files = await git(
    worktree,
    "diff",
    "--name-only",
    `${base}...HEAD`,
    "--",
    ...folders
  );
  return files === "" ? [] : files.split("\n");
};

// ---------------------------------------------------------------------------
// The migration

const journalTags = async (migrations: string): Promise<string[]> => {
  const file = path.join(migrations, "meta", "_journal.json");
  if (!existsSync(file)) {
    return [];
  }
  const journal = JSON.parse(await readFile(file, "utf-8")) as {
    entries?: { tag: string }[];
  };
  return (journal.entries ?? []).map((entry) => entry.tag);
};

/**
 * Generates the change's migrations; resolves with the SQL files written,
 * relative to the worktree, one for each folder whose schema changed.
 */
export type Generate = (worktree: string, name: string) => Promise<string[]>;

/**
 * Runs drizzle-kit `args` in `cwd` and returns the tag of the one migration
 * it added to `migrations`, or undefined when the schema had no changes.
 * Which files appeared decides it, since drizzle-kit exits 0 on failure.
 */
export const runGenerate = async (
  cwd: string,
  migrations: string,
  args: readonly string[]
): Promise<string | undefined> => {
  const before = new Set(await journalTags(migrations));
  const { stdout, stderr } = await capture("pnpm", ["exec", ...args], { cwd });
  const output = `${stdout}${stderr}`;
  const after = await journalTags(migrations);
  const added = after.filter((tag) => !before.has(tag));
  if (added.length > 1) {
    throw new FxError(
      "migration_failed",
      `drizzle-kit generate wrote ${added.length} migrations (${added.join(", ")}); a change ships exactly one.`
    );
  }
  if (added[0] !== undefined) {
    return added[0];
  }
  if (plainText(output).includes("nothing to migrate")) {
    return undefined;
  }
  if (wantedToAsk(output)) {
    throw new FxError(
      "migration_failed",
      renameQuestion,
      'Renames are not expand-safe anyway: add the new table or column in this change and copy the data, then drop the old one in a later change shipped with `fx ship --contract-step "<why it is safe now>"`.'
    );
  }
  throw new FxError(
    "migration_failed",
    `drizzle-kit generate failed: ${errorLine(output)}`
  );
};

/**
 * `drizzle-kit generate --name <name>` in the db package, then in each
 * system package, one after another.
 */
export const generateMigrations: Generate = async (worktree, name) => {
  const written: string[] = [];
  for (const target of await migrationTargets(worktree)) {
    const dir =
      target.migrations === migrationsPath
        ? dbPackageDir(worktree)
        : path.join(worktree, target.dir);
    // oxlint-disable-next-line eslint/no-await-in-loop -- drizzle-kit runs one at a time
    const tag = await runGenerate(dir, path.join(worktree, target.migrations), [
      "drizzle-kit",
      "generate",
      "--name",
      name,
    ]);
    if (tag) {
      written.push(path.join(target.migrations, `${tag}.sql`));
    }
  }
  return written;
};

/** The migration's name: the slug, in the snake case drizzle-kit uses. */
export const migrationName = (slug: string): string =>
  slug.replaceAll("-", "_");

const commitMigrations = async (
  worktree: string,
  change: Change,
  files: readonly string[],
  contractStep: string | undefined
): Promise<void> => {
  if (contractStep) {
    await Promise.all(
      files.map(async (file) => {
        const absolute = path.join(worktree, file);
        await writeFile(
          absolute,
          withContractStep(await readFile(absolute, "utf-8"), contractStep)
        );
      })
    );
  }
  const folders = [...new Set(files.map((file) => path.dirname(file)))];
  await git(worktree, "add", "--", ...folders);
  await git(
    worktree,
    "commit",
    "--quiet",
    "--no-verify",
    "-m",
    `chore: migration for ${change.name}`,
    "-m",
    "Generated by fx ship from the schema. fx ship replaces this commit each time it runs, so don't edit it.",
    "-m",
    `${migrationTrailer}: ${change.slug}`
  );
};

// ---------------------------------------------------------------------------
// Checks

export interface Check {
  readonly name: string;
  readonly command: readonly [string, ...string[]];
}

export interface CheckRun {
  readonly name: string;
  readonly passed: boolean;
  readonly ms: number;
}

/** What fx ship runs, in order, before it pushes: the same checks as CI. */
export const defaultChecks: readonly Check[] = [
  { name: "migration lint", command: ["pnpm", "db:lint-migrations"] },
  { name: "typecheck", command: ["pnpm", "typecheck"] },
  { name: "lint", command: ["pnpm", "lint"] },
  { name: "tests", command: ["pnpm", "test"] },
  { name: "config", command: ["pnpm", "config:validate"] },
  {
    name: "migrations on a fresh database",
    command: ["pnpm", "db:check-migrations"],
  },
];

/** Runs checks in order, stopping at the first that fails. */
const runChecks = async (
  checks: readonly Check[],
  options: { cwd: string; env: NodeJS.ProcessEnv; log: (line: string) => void },
  done: readonly CheckRun[] = []
): Promise<CheckRun[]> => {
  const [check, ...rest] = checks;
  if (!check) {
    return [...done];
  }
  options.log(`Running ${check.name}…`);
  const started = performance.now();
  const [command, ...args] = check.command;
  const code = await runToStderr(command, args, options);
  const run: CheckRun = {
    name: check.name,
    passed: code === 0,
    ms: Math.round(performance.now() - started),
  };
  return run.passed
    ? await runChecks(rest, options, [...done, run])
    : [...done, run];
};

// ---------------------------------------------------------------------------
// Pushing and the pull request

/** A remote's web address, e.g. https://github.com/owner/repo, if it has one. */
export const webUrl = (remote: string): string | undefined => {
  if (/^[a-z+]+:\/\//u.test(remote)) {
    const url = new URL(remote);
    if (!["https:", "http:", "ssh:", "git:"].includes(url.protocol)) {
      return undefined;
    }
    const repoPath = url.pathname.replace(/\.git$/u, "").replace(/\/$/u, "");
    return repoPath === "" ? undefined : `https://${url.hostname}${repoPath}`;
  }
  const scp =
    /^(?:[^@/]+@)?(?<host>[^:/]+):(?<repoPath>[^/].*?)(?:\.git)?$/u.exec(
      remote
    );
  return scp?.groups
    ? `https://${scp.groups.host}/${scp.groups.repoPath}`
    : undefined;
};

/** The page that compares `branch` with `base`, in GitHub's URL format. */
export const compareUrl = (
  remote: string,
  base: string,
  branch: string
): string | undefined => {
  const web = webUrl(remote);
  return web ? `${web}/compare/${base}...${branch}?expand=1` : undefined;
};

export interface PullRequest {
  readonly url: string;
  /** False when fx ship found one already open and updated it. */
  readonly created: boolean;
}

/** Opens a PR, or finds the open one; resolves undefined when gh isn't installed. */
export type OpenPullRequest = (
  worktree: string,
  branch: string,
  base: string
) => Promise<PullRequest | undefined>;

/** Watches GitHub's `check` after the push. Tests replace it. */
export type WatchRemoteCheck = (
  worktree: string,
  branch: string
) => Promise<RemoteCheck | null>;

/** Commit messages on the branch, oldest first. */
const commitMessages = async (
  worktree: string,
  base: string
): Promise<string[]> => {
  const raw = await git(
    worktree,
    "log",
    "--reverse",
    "--format=%B%x1e",
    `${base}..HEAD`
  );
  return raw
    .split("\u001E")
    .map((message) => message.trim())
    .filter((message) => message !== "");
};

/**
 * The branch's commit messages for its pull request, oldest first. They are
 * counted from `origin/<base>`, which ship has just rebased on: a local
 * `main` that lags or has diverged would pull other changes' commits in.
 */
export const pullRequestMessages = (
  worktree: string,
  base: string
): Promise<string[]> => commitMessages(worktree, `origin/${base}`);

/**
 * The pull request title is the first commit's subject, which is what a
 * squash onto main keeps. The body is every commit, so a later ship can
 * refresh it.
 */
export const pullRequestCopy = (
  messages: readonly string[]
): { readonly title: string; readonly body: string } => {
  const trimmed = messages
    .map((message) => message.trim())
    .filter((message) => message !== "");
  const first = trimmed[0] ?? "update";
  const title = first.split("\n")[0] ?? "update";
  return { title, body: trimmed.join("\n\n") };
};

/** Opens a PR with gh, or refreshes the open one's title and body. */
export const openWithGh: OpenPullRequest = async (worktree, branch, base) => {
  if (!(await ghInstalled(worktree))) {
    return;
  }
  const copy = pullRequestCopy(await pullRequestMessages(worktree, base));
  const bodyFile = path.join(tmpdir(), `fx-pr-${randomUUID()}.md`);
  await writeFile(bodyFile, copy.body);
  try {
    const open = await capture(
      "gh",
      [
        "pr",
        "list",
        "--head",
        branch,
        "--state",
        "open",
        "--json",
        "url",
        "--jq",
        ".[0].url // empty",
      ],
      { cwd: worktree }
    );
    const existing = open.stdout.trim();
    if (open.code === 0 && existing !== "") {
      const edit = await capture(
        "gh",
        [
          "pr",
          "edit",
          existing,
          "--title",
          copy.title,
          "--body-file",
          bodyFile,
        ],
        { cwd: worktree }
      );
      if (edit.code !== 0) {
        throw new FxError(
          "command_failed",
          `gh pr edit failed: ${errorLine(`${edit.stderr}${edit.stdout}`)}`,
          "The branch is pushed; update the PR body on your git host."
        );
      }
      return { url: existing, created: false };
    }
    const created = await capture(
      "gh",
      [
        "pr",
        "create",
        "--base",
        base,
        "--head",
        branch,
        "--title",
        copy.title,
        "--body-file",
        bodyFile,
      ],
      { cwd: worktree }
    );
    const url = created.stdout.trim().split("\n").at(-1) ?? "";
    if (created.code !== 0 || !url.startsWith("http")) {
      throw new FxError(
        "command_failed",
        `gh pr create failed: ${errorLine(`${created.stderr}${created.stdout}`)}`,
        "The branch is pushed; open the PR on your git host."
      );
    }
    return { url, created: true };
  } finally {
    await rm(bodyFile, { force: true });
  }
};

// ---------------------------------------------------------------------------
// fx ship

export interface ShipOptions {
  /** Mark the migration as the contract step, with this reason. */
  readonly contractStep?: string;
  /** Where progress goes; stderr by default, so stdout stays clean for --json. */
  readonly log?: (line: string) => void;
  /** Replaced in tests. */
  readonly generate?: Generate;
  readonly checks?: readonly Check[];
  readonly openPullRequest?: OpenPullRequest;
  /** After a push. The default watches GitHub and skips any other remote. */
  readonly watchRemoteCheck?: WatchRemoteCheck;
}

export interface ShipResult {
  /** The change, with this run's checks recorded. */
  readonly change: Change;
  /** The change's migrations, relative to the worktree: one per folder whose schema changed. */
  readonly migrations: readonly string[];
  readonly contractStep: string | null;
  readonly checks: readonly CheckRun[];
  readonly pushed: boolean;
  readonly pullRequest: PullRequest | null;
  /** Where to open a PR by hand, when fx ship didn't open one. */
  readonly compareUrl: string | null;
  /** GitHub's `check` after the push. Null when this remote is not watched. */
  readonly remoteCheck: RemoteCheck | null;
}

const findShippableChange = async (cwd: string) => {
  const repo = await findRepo(cwd);
  const change = changeForPath(
    await listChanges(repo.stateDir),
    repo.worktreeRoot
  );
  if (!change) {
    throw new FxError(
      "change_not_found",
      `${repo.worktreeRoot} isn't a change's worktree, so there is nothing to ship.`,
      "cd into the change's worktree; `pnpm fx status` lists them."
    );
  }
  const branch = await currentBranch(change.worktree);
  if (branch !== change.branch) {
    throw new FxError(
      "command_failed",
      `${change.worktree} is on ${branch ?? "a detached HEAD"}, not ${change.branch}.`,
      `Check out ${change.branch} in the worktree, then run fx ship again.`
    );
  }
  const changes = await git(change.worktree, "status", "--porcelain");
  if (changes !== "") {
    throw new FxError(
      "dirty_worktree",
      `${change.worktree} has uncommitted changes:\n  ${changes.split("\n").slice(0, 5).join("\n  ")}`,
      "Commit them (fx ship ships commits), or stash them with `git stash -u`, then run fx ship again."
    );
  }
  return { repo, change };
};

type Log = (line: string) => void;

/**
 * Takes out the migration an earlier ship wrote and rebases on `base`, so
 * the branch holds only the person's commits on top of an up-to-date main.
 * Returns the old migration's contract-step reason.
 */
const updateHistory = async (
  change: Change,
  base: string,
  log: Log
): Promise<string | undefined> => {
  const { worktree } = change;
  const kept = await dropMigrationCommits(worktree, base, change.slug);
  log(`Rebasing ${change.branch} on ${base}…`);
  await rebaseOn(worktree, base);

  const targets = await migrationTargets(worktree);
  const folders = targets.map((target) => target.migrations);
  const edited = await editedMigrations(worktree, base, folders);
  if (edited.length > 0) {
    throw new FxError(
      "migration_failed",
      `This change edits migrations by hand:\n  ${edited.join("\n  ")}`,
      `fx ship writes the change's migrations from the schema. Undo those edits (\`git checkout ${base} -- ${folders.join(" ")}\`), commit, and run fx ship again.`
    );
  }
  const commits = await git(worktree, "rev-list", "--count", `${base}..HEAD`);
  if (commits === "0") {
    throw new FxError(
      "nothing_to_ship",
      `${change.branch} has no commits on top of ${base}.`,
      "Commit your work, then run fx ship."
    );
  }
  return kept;
};

/** Generates and commits the change's migrations, if a schema changed. */
const writeMigrations = async (
  change: Change,
  generate: Generate,
  contractStep: string | undefined,
  log: Log
): Promise<{ migrations: string[]; contractStep: string | null }> => {
  log("Generating the change's migrations from the schema…");
  const migrations = await generate(
    change.worktree,
    migrationName(change.slug)
  );
  if (migrations.length === 0) {
    log("The schema didn't change, so there is no migration.");
    return { migrations, contractStep: null };
  }
  await commitMigrations(change.worktree, change, migrations, contractStep);
  log(
    `Wrote ${migrations.join(", ")}${contractStep ? ` (contract step: ${contractStep})` : ""}.`
  );
  return { migrations, contractStep: contractStep ?? null };
};

/** Runs the checks and records the result on the change. Throws if one failed. */
const checkChange = async (
  stateDir: string,
  change: Change,
  checks: readonly Check[],
  log: Log
): Promise<{ shipped: Change; runs: CheckRun[] }> => {
  const url = databaseUrl(requireAdminUrl(), change.database);
  const runs = await runChecks(checks, {
    cwd: change.worktree,
    env: { ...process.env, DATABASE_URL: url },
    log,
  });
  const passed = runs.every((run) => run.passed);
  const shipped: Change = {
    ...change,
    lastCheck: {
      passed,
      at: new Date().toISOString(),
      commit: await git(change.worktree, "rev-parse", "HEAD"),
    },
  };
  await saveChange(stateDir, shipped);
  if (!passed) {
    throw new FxError(
      "checks_failed",
      `${runs.at(-1)?.name ?? "A check"} failed, so fx ship didn't push. Its output is above.`,
      "Fix it, commit, and run fx ship again; it replaces the migration commit each time."
    );
  }
  return { shipped, runs };
};

/**
 * The remote-tracking commit for `branch`, or null when this checkout has
 * never seen it. This is the commit a later push may replace. Reading it
 * here, rather than letting `--force-with-lease` read the tracking ref at
 * push time, means a fetch during the checks cannot widen what we overwrite.
 */
const trackedRemote = async (
  cwd: string,
  branch: string
): Promise<string | null> => {
  try {
    const sha = await git(
      cwd,
      "rev-parse",
      "--verify",
      "--quiet",
      `refs/remotes/origin/${branch}`
    );
    return sha || null;
  } catch {
    return null;
  }
};

/** Pushes the branch, then opens a PR or works out where to open one. */
const publish = async (
  change: Change,
  /** The remote commit this checkout last saw, or null if the branch is new. */
  expectedRemote: string | null,
  openPullRequest: OpenPullRequest,
  log: Log
): Promise<Pick<ShipResult, "pushed" | "pullRequest" | "compareUrl">> => {
  log(`Pushing ${change.branch}…`);
  const lease = `--force-with-lease=refs/heads/${change.branch}:${expectedRemote ?? ""}`;
  try {
    await git(
      change.worktree,
      "push",
      "--quiet",
      lease,
      "--set-upstream",
      "origin",
      change.branch
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (message.includes("stale info")) {
      throw new FxError(
        "command_failed",
        `Refusing to push ${change.branch}: origin moved since this checkout last saw ${expectedRemote ?? "no branch"}. ${message}`,
        "Fetch the remote branch, look at the commits, and ship again."
      );
    }
    throw error;
  }
  const pullRequest = await openPullRequest(
    change.worktree,
    change.branch,
    mainBranch
  );
  if (pullRequest) {
    return { pushed: true, pullRequest, compareUrl: null };
  }
  const remote = await git(change.worktree, "remote", "get-url", "origin");
  return {
    pushed: true,
    pullRequest: null,
    compareUrl: compareUrl(remote, mainBranch, change.branch) ?? null,
  };
};

/**
 * `fx ship`: rebases the change on main, writes its one migration from the
 * schema (replacing the one an earlier ship wrote), runs the checks, then
 * pushes, opens or refreshes the PR, and waits for GitHub's `check`.
 */
export const ship = async (
  cwd: string,
  options: ShipOptions = {}
): Promise<ShipResult> => {
  const log =
    options.log ?? ((line: string) => process.stderr.write(`${line}\n`));
  if (options.contractStep?.includes("\n")) {
    throw new FxError(
      "usage",
      "The contract-step reason must be one line.",
      'Usage: fx ship [--contract-step "<why it is safe now>"] [--json]'
    );
  }
  const { repo, change } = await findShippableChange(cwd);
  const origin = await hasOrigin(repo.mainRoot);
  const base = origin ? `origin/${mainBranch}` : mainBranch;
  const expectedRemote = origin
    ? await trackedRemote(change.worktree, change.branch)
    : null;
  if (origin) {
    log(`Fetching origin/${mainBranch}…`);
    await git(repo.mainRoot, "fetch", "--quiet", "origin", mainBranch);
  }

  const kept = await updateHistory(change, base, log);
  const written = await writeMigrations(
    change,
    options.generate ?? generateMigrations,
    options.contractStep ?? kept,
    log
  );
  const { shipped, runs } = await checkChange(
    repo.stateDir,
    change,
    options.checks ?? defaultChecks,
    log
  );
  const published = origin
    ? await publish(
        change,
        expectedRemote,
        options.openPullRequest ?? openWithGh,
        log
      )
    : { pushed: false, pullRequest: null, compareUrl: null };
  const remoteCheck = published.pushed
    ? await (options.watchRemoteCheck ?? watchRemoteCheck)(
        change.worktree,
        change.branch
      )
    : null;
  if (remoteCheck?.state === "failed") {
    throw new FxError(
      "checks_failed",
      [
        `GitHub's check failed${remoteCheck.url ? `: ${remoteCheck.url}` : ""}.`,
        remoteCheck.detail ?? "",
      ]
        .filter((line) => line !== "")
        .join("\n"),
      "Fix it, commit, and run fx ship again. The branch is already pushed."
    );
  }
  return {
    change: shipped,
    ...written,
    checks: runs,
    ...published,
    remoteCheck,
  };
};

const where = (result: ShipResult): string => {
  if (result.pullRequest) {
    return `  PR         ${result.pullRequest.url} (${result.pullRequest.created ? "opened" : "updated"})`;
  }
  if (result.compareUrl) {
    return `  pushed     open a PR at ${result.compareUrl}`;
  }
  return result.pushed
    ? `  pushed     ${result.change.branch}; open a PR on your git host`
    : "  pushed     no: the repo has no origin remote";
};

const ciLine = (result: ShipResult): string | undefined => {
  if (!result.pushed) {
    return undefined;
  }
  if (!result.remoteCheck) {
    return "  ci         not watched; merge after GitHub's check is green";
  }
  const url = result.remoteCheck.url ? `  ${result.remoteCheck.url}` : "";
  return `  ci         ${result.remoteCheck.state}${url}`;
};

/** The human-readable result of `fx ship`. */
export const formatShip = (result: ShipResult): string =>
  `${[
    `Shipped "${result.change.name}".`,
    `  migration  ${result.migrations.join(", ") || "none (the schema didn't change)"}${result.contractStep ? ` (contract step: ${result.contractStep})` : ""}`,
    `  checks     ${result.checks.map((check) => check.name).join(", ")} passed`,
    where(result),
    ciLine(result),
  ]
    .filter((line) => line !== undefined)
    .join("\n")}\n`;
