import { existsSync } from "node:fs";
import path from "node:path";

import {
  dropDatabase,
  listDatabases,
  templateDatabaseName,
  templatePrefixFor,
  withAdmin,
} from "@workspace/testing/databases";

import { requireAdminUrl } from "../admin.ts";
import { FxError } from "../errors.ts";
import { currentBranch, findRepo, git, hasOrigin } from "../git.ts";
import type { Repo } from "../git.ts";
import { capture, errorLine } from "../process.ts";
import { changeForPath, listChanges, removeChange } from "../state.ts";
import type { Change } from "../state.ts";
import { requireChange } from "./switch.ts";

const migrationsFolder = (root: string): string =>
  path.join(root, "packages", "db", "migrations");

const succeeds = async (cwd: string, ...args: string[]): Promise<boolean> => {
  try {
    await git(cwd, ...args);
    return true;
  } catch {
    return false;
  }
};

/**
 * Head commits of merged pull requests from `branch`, or none when gh is
 * missing or the lookup fails. A merged pull request for the branch name is
 * not enough: the local tip may have commits that were never in that pull request.
 */
const mergedPullRequestHeads = async (
  cwd: string,
  branch: string
): Promise<readonly string[]> => {
  try {
    const found = await capture(
      "gh",
      [
        "pr",
        "list",
        "--head",
        branch,
        "--state",
        "merged",
        "--json",
        "headRefOid",
      ],
      { cwd }
    );
    if (found.code !== 0) {
      return [];
    }
    const rows = JSON.parse(found.stdout) as { headRefOid?: unknown }[];
    return rows.flatMap((row) =>
      typeof row.headRefOid === "string" ? [row.headRefOid] : []
    );
  } catch {
    return [];
  }
};

/**
 * True when `branch`'s tip is in `base`: merged or fast-forwarded (it is in
 * base's history), squash-merged (merging it into base changes nothing), or
 * the head commit of a merged pull request. A merged pull request whose head
 * is an older commit does not count.
 */
export const isMerged = async (
  cwd: string,
  branch: string,
  base: string
): Promise<boolean> => {
  if (await succeeds(cwd, "merge-base", "--is-ancestor", branch, base)) {
    return true;
  }
  try {
    const merge = await git(cwd, "merge-tree", "--write-tree", base, branch);
    const [tree] = merge.split("\n");
    if (tree === (await git(cwd, "rev-parse", `${base}^{tree}`))) {
      return true;
    }
  } catch {
    // The merge conflicts, so base doesn't have the branch's changes as-is.
  }
  const tip = await git(cwd, "rev-parse", branch);
  const heads = await mergedPullRequestHeads(cwd, branch);
  return heads.includes(tip);
};

/** Template databases that neither the main checkout nor any open change uses. */
export const staleTemplates = (
  existing: readonly string[],
  inUse: ReadonlySet<string>
): string[] =>
  existing.filter((name) => !name.includes("_build_") && !inUse.has(name));

const templateFor = (root: string): string | undefined =>
  existsSync(migrationsFolder(root))
    ? templateDatabaseName(migrationsFolder(root))
    : undefined;

const pruneTemplates = async (
  repo: Repo,
  adminUrl: string
): Promise<string[]> => {
  const open = await listChanges(repo.stateDir);
  const roots = [repo.mainRoot, ...open.map((change) => change.worktree)];
  const inUse = new Set(
    roots.map(templateFor).filter((name) => name !== undefined)
  );
  // Only this checkout's templates. Another clone shares the server and the
  // `factory_template_` shape, and its databases must survive this prune.
  const existing = await withAdmin(
    (client) => listDatabases(client, templatePrefixFor(repo.mainRoot)),
    adminUrl
  );
  const stale = staleTemplates(existing, inUse);
  await Promise.all(
    stale.map((name) =>
      withAdmin((client) => dropDatabase(client, name), adminUrl)
    )
  );
  return stale;
};

export interface DoneOptions {
  /** Remove the change even if it isn't merged or has uncommitted work. */
  readonly force?: boolean;
  /** Drop template databases nothing uses any more. Tests turn it off. */
  readonly pruneTemplates?: boolean;
  /** Where progress goes; stderr by default, so stdout stays clean for --json. */
  readonly log?: (line: string) => void;
  /** Installs dependencies in the main checkout. Tests replace it. */
  readonly install?: (cwd: string) => Promise<void>;
}

export interface MainUpdate {
  readonly fastForwarded: boolean;
  readonly installed: boolean;
  /** Why the main checkout was left as it is, when it was. */
  readonly note: string | null;
}

export interface DoneResult {
  readonly change: Change;
  readonly merged: boolean;
  /** True when origin's copy of the branch was deleted too. */
  readonly deletedRemoteBranch: boolean;
  readonly prunedTemplates: readonly string[];
  /** Where to cd, when fx done ran inside the worktree it removed. */
  readonly cd: string | null;
  /** What happened to the main checkout. Null when there was no origin, or the change was not merged. */
  readonly main: MainUpdate | null;
}

const findDoneChange = async (
  repo: Repo,
  name: string | undefined
): Promise<Change> => {
  if (name !== undefined) {
    return await requireChange(repo.stateDir, name);
  }
  const current = changeForPath(
    await listChanges(repo.stateDir),
    repo.worktreeRoot
  );
  if (!current) {
    throw new FxError(
      "change_not_found",
      `${repo.worktreeRoot} isn't a change's worktree.`,
      "Name the change: `fx done <name>`. `fx status` lists them."
    );
  }
  return current;
};

/** Refuses to remove work that would be lost, unless forced. */
const assertSafe = async (
  change: Change,
  merged: boolean,
  base: string,
  force: boolean
): Promise<void> => {
  if (force) {
    return;
  }
  if (!merged) {
    throw new FxError(
      "change_not_merged",
      `${change.branch} isn't merged into ${base}, so fx done would lose its work.`,
      `Ship it with \`fx ship\` and merge the PR first. To throw the change away, run \`fx done ${change.slug} --force\`.`
    );
  }
  if (
    existsSync(change.worktree) &&
    (await git(change.worktree, "status", "--porcelain")) !== ""
  ) {
    throw new FxError(
      "dirty_worktree",
      `${change.worktree} has uncommitted changes.`,
      `Commit and ship them, or throw them away with \`fx done ${change.slug} --force\`.`
    );
  }
};

/** The commit origin's `branch` points at, or null when the branch is absent. */
const remoteTip = async (
  cwd: string,
  branch: string
): Promise<string | null> => {
  const listed = await git(cwd, "ls-remote", "--heads", "origin", branch);
  const [sha] = listed.split(/\s+/u);
  return sha || null;
};

/**
 * Deletes origin's `branch` only when it still points at `tip`, the commit
 * `isMerged` checked. A lease refuses the delete if the remote moved.
 */
const deleteRemoteBranch = async (
  cwd: string,
  branch: string,
  tip: string
): Promise<boolean> => {
  const remote = await remoteTip(cwd, branch);
  if (remote === null) {
    return false;
  }
  if (remote !== tip) {
    throw new FxError(
      "change_not_merged",
      `origin/${branch} is at ${remote}, which fx done has not checked. It only verified ${tip}.`,
      "Look at the commits on the remote branch before deleting it."
    );
  }
  await git(
    cwd,
    "push",
    "--quiet",
    "origin",
    `--force-with-lease=refs/heads/${branch}:${tip}`,
    `:refs/heads/${branch}`
  );
  return true;
};

/** Removes the worktree and the local branch. The remote is handled separately. */
const removeLocalBranch = async (
  repo: Repo,
  change: Change,
  force: boolean
): Promise<void> => {
  // A worktree folder someone already deleted only needs git's record pruned.
  const removeWorktree = existsSync(change.worktree)
    ? ["worktree", "remove", ...(force ? ["--force"] : []), change.worktree]
    : ["worktree", "prune"];
  await git(repo.mainRoot, ...removeWorktree);
  if ((await git(repo.mainRoot, "branch", "--list", change.branch)) !== "") {
    await git(repo.mainRoot, "branch", "-D", change.branch);
  }
};

const installDependencies = async (cwd: string): Promise<void> => {
  if (!existsSync(path.join(cwd, "package.json"))) {
    return;
  }
  const result = await capture("pnpm", ["install"], { cwd });
  if (result.code !== 0) {
    throw new FxError(
      "command_failed",
      `pnpm install failed in ${cwd} (exit ${result.code ?? "signal"}): ${errorLine(`${result.stderr}${result.stdout}`)}`,
      "The change is already removed. Run `pnpm install` in the main checkout."
    );
  }
};

/**
 * Fast-forwards a clean main checkout onto origin/main, and installs when
 * the lockfile changed. A dirty checkout, or one not on main, is left as it is.
 */
const syncMain = async (
  repo: Repo,
  install: (cwd: string) => Promise<void>,
  log: (line: string) => void
): Promise<MainUpdate> => {
  const branch = await currentBranch(repo.mainRoot);
  if (branch !== "main") {
    return {
      fastForwarded: false,
      installed: false,
      note: `Main checkout is on ${branch ?? "a detached HEAD"}, so it was left as it is.`,
    };
  }
  const dirty = await git(repo.mainRoot, "status", "--porcelain");
  if (dirty !== "") {
    const files = dirty.split("\n").slice(0, 5).join("\n  ");
    return {
      fastForwarded: false,
      installed: false,
      note: `Main checkout has uncommitted changes:\n  ${files}\nStash them, then \`git merge --ff-only origin/main\` in ${repo.mainRoot}.`,
    };
  }
  const before = await git(repo.mainRoot, "rev-parse", "HEAD");
  try {
    await git(repo.mainRoot, "merge", "--ff-only", "origin/main");
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      fastForwarded: false,
      installed: false,
      note: `Main checkout could not fast-forward to origin/main. ${message}`,
    };
  }
  const after = await git(repo.mainRoot, "rev-parse", "HEAD");
  if (before === after) {
    return { fastForwarded: false, installed: false, note: null };
  }
  log("Fast-forwarded the main checkout to origin/main…");
  const lockfile = await git(
    repo.mainRoot,
    "diff",
    "--name-only",
    before,
    after,
    "--",
    "pnpm-lock.yaml"
  );
  if (lockfile === "") {
    return { fastForwarded: true, installed: false, note: null };
  }
  log("Installing dependencies in the main checkout…");
  await install(repo.mainRoot);
  return { fastForwarded: true, installed: true, note: null };
};

/**
 * `fx done [<name>]`: once a change is merged, removes its worktree, branch,
 * database and state entry, then drops template databases nothing uses.
 * A clean main checkout is fast-forwarded to origin/main.
 * Refuses unmerged or uncommitted work unless forced.
 */
export const done = async (
  cwd: string,
  name?: string,
  options: DoneOptions = {}
): Promise<DoneResult> => {
  const log =
    options.log ?? ((line: string) => process.stderr.write(`${line}\n`));
  const repo = await findRepo(cwd);
  const change = await findDoneChange(repo, name);
  const adminUrl = requireAdminUrl();
  const origin = await hasOrigin(repo.mainRoot);
  const base = origin ? "origin/main" : "main";
  if (origin) {
    log("Fetching origin/main…");
    await git(repo.mainRoot, "fetch", "--quiet", "origin", "main");
  }
  const branchExists =
    (await git(repo.mainRoot, "branch", "--list", change.branch)) !== "";
  // With no branch left there is no local tip to verify, so the remote
  // branch is left alone: deleting it could drop commits nothing checked.
  const merged =
    !branchExists || (await isMerged(repo.mainRoot, change.branch, base));
  const force = options.force === true;
  await assertSafe(change, merged, base, force);

  const deletedRemoteBranch =
    merged && origin && branchExists
      ? await deleteRemoteBranch(
          repo.mainRoot,
          change.branch,
          await git(repo.mainRoot, "rev-parse", change.branch)
        )
      : false;
  log(`Removing ${change.worktree} and ${change.branch}…`);
  await removeLocalBranch(repo, change, force);
  log(`Dropping database ${change.database}…`);
  await withAdmin((client) => dropDatabase(client, change.database), adminUrl);
  await removeChange(repo.stateDir, change.slug);
  const prunedTemplates =
    options.pruneTemplates === false
      ? []
      : await pruneTemplates(repo, adminUrl);

  const fromWorktree = path.relative(change.worktree, cwd);
  const inside =
    !fromWorktree.startsWith("..") && !path.isAbsolute(fromWorktree);
  const main =
    merged && origin
      ? await syncMain(repo, options.install ?? installDependencies, log)
      : null;
  return {
    change,
    merged,
    deletedRemoteBranch,
    prunedTemplates,
    cd: inside ? repo.mainRoot : null,
    main,
  };
};

/** The human-readable result of `fx done`. */
export const formatDone = (result: DoneResult): string => {
  const lines = [
    `Done with "${result.change.name}"${result.merged ? "" : " (not merged; its work is gone)"}.`,
    `  removed   ${result.change.worktree}, ${result.change.branch}${result.deletedRemoteBranch ? " (and on origin)" : ""} and ${result.change.database}`,
  ];
  if (result.prunedTemplates.length > 0) {
    lines.push(`  pruned    ${result.prunedTemplates.join(", ")}`);
  }
  if (result.main?.fastForwarded) {
    lines.push(
      result.main.installed
        ? "  main      fast-forwarded to origin/main and dependencies installed"
        : "  main      fast-forwarded to origin/main"
    );
  } else if (result.main?.note) {
    lines.push(`  main      ${result.main.note}`);
  }
  if (result.cd) {
    lines.push("", `Its worktree is gone; cd ${result.cd}`);
  }
  return `${lines.join("\n")}\n`;
};
