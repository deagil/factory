import { existsSync } from "node:fs";
import path from "node:path";

import {
  dropDatabase,
  listDatabases,
  migrationsHash,
  templatePrefix,
  withAdmin,
} from "@workspace/testing/databases";

import { requireAdminUrl } from "../admin.ts";
import { FxError } from "../errors.ts";
import { findRepo, git, hasOrigin } from "../git.ts";
import type { Repo } from "../git.ts";
import { capture } from "../process.ts";
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

/** True when gh knows of a merged PR from `branch`. False without gh. */
const mergedOnGitHub = async (
  cwd: string,
  branch: string
): Promise<boolean> => {
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
        "number",
        "--jq",
        "length",
      ],
      { cwd }
    );
    return found.code === 0 && Number(found.stdout.trim()) > 0;
  } catch {
    return false;
  }
};

/**
 * True when `branch`'s work is in `base`: merged or fast-forwarded (it is in
 * base's history), squash-merged (merging it into base changes nothing), or
 * merged according to gh.
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
  return await mergedOnGitHub(cwd, branch);
};

/** Template databases that neither the main checkout nor any open change uses. */
export const staleTemplates = (
  existing: readonly string[],
  inUse: ReadonlySet<string>
): string[] =>
  existing.filter((name) => !name.includes("_build_") && !inUse.has(name));

const templateFor = (root: string): string | undefined =>
  existsSync(migrationsFolder(root))
    ? `${templatePrefix}${migrationsHash(migrationsFolder(root))}`
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
  const existing = await withAdmin(
    (client) => listDatabases(client, templatePrefix),
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
}

export interface DoneResult {
  readonly change: Change;
  readonly merged: boolean;
  /** True when origin's copy of the branch was deleted too. */
  readonly deletedRemoteBranch: boolean;
  readonly prunedTemplates: readonly string[];
  /** Where to cd, when fx done ran inside the worktree it removed. */
  readonly cd: string | null;
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

/** Removes the worktree, the local branch and, once merged, origin's copy. */
const removeBranch = async (
  repo: Repo,
  change: Change,
  options: { merged: boolean; origin: boolean; force: boolean }
): Promise<boolean> => {
  // A worktree folder someone already deleted only needs git's record pruned.
  const removeWorktree = existsSync(change.worktree)
    ? [
        "worktree",
        "remove",
        ...(options.force ? ["--force"] : []),
        change.worktree,
      ]
    : ["worktree", "prune"];
  await git(repo.mainRoot, ...removeWorktree);
  if ((await git(repo.mainRoot, "branch", "--list", change.branch)) !== "") {
    await git(repo.mainRoot, "branch", "-D", change.branch);
  }
  if (!options.merged || !options.origin) {
    return false;
  }
  const onOrigin = await git(
    repo.mainRoot,
    "ls-remote",
    "--heads",
    "origin",
    change.branch
  );
  if (onOrigin === "") {
    return false;
  }
  await git(
    repo.mainRoot,
    "push",
    "--quiet",
    "origin",
    "--delete",
    change.branch
  );
  return true;
};

/**
 * `fx done [<name>]`: once a change is merged, removes its worktree, branch,
 * database and state entry, then drops template databases nothing uses.
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
  // With no branch left there is no unmerged work to lose.
  const merged =
    !branchExists || (await isMerged(repo.mainRoot, change.branch, base));
  const force = options.force === true;
  await assertSafe(change, merged, base, force);

  log(`Removing ${change.worktree} and ${change.branch}…`);
  const deletedRemoteBranch = await removeBranch(repo, change, {
    merged,
    origin,
    force,
  });
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
  return {
    change,
    merged,
    deletedRemoteBranch,
    prunedTemplates,
    cd: inside ? repo.mainRoot : null,
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
  if (result.cd) {
    lines.push("", `Its worktree is gone; cd ${result.cd}`);
  }
  return `${lines.join("\n")}\n`;
};
