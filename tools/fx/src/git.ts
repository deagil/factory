import { execFile } from "node:child_process";
import path from "node:path";
import { promisify } from "node:util";

import { FxError } from "./errors.ts";

const execFileAsync = promisify(execFile);

/** Runs git in `cwd` and returns trimmed stdout. */
export const git = async (cwd: string, ...args: string[]): Promise<string> => {
  try {
    const { stdout } = await execFileAsync("git", args, { cwd });
    return stdout.trim();
  } catch (error) {
    const stderr = (error as { stderr?: string }).stderr?.trim();
    throw new FxError(
      "command_failed",
      `git ${args.join(" ")} failed${stderr ? `: ${stderr}` : ""}`
    );
  }
};

export interface Repo {
  /** Root of the worktree `cwd` is in. */
  readonly worktreeRoot: string;
  /** Root of the main checkout, which holds `.fx/`. */
  readonly mainRoot: string;
  /** The repo's name: the main checkout's folder name. */
  readonly name: string;
  readonly stateDir: string;
}

/** Finds the repo `cwd` is in. Throws if it isn't in one. */
export const findRepo = async (cwd: string): Promise<Repo> => {
  let worktreeRoot: string;
  let commonDir: string;
  try {
    worktreeRoot = await git(cwd, "rev-parse", "--show-toplevel");
    commonDir = path.resolve(
      cwd,
      await git(cwd, "rev-parse", "--git-common-dir")
    );
  } catch {
    throw new FxError(
      "not_in_repo",
      `${cwd} is not inside a git repository.`,
      "Run fx from the factory repo or one of its worktrees."
    );
  }
  const mainRoot = path.dirname(commonDir);
  return {
    worktreeRoot,
    mainRoot,
    name: path.basename(mainRoot),
    stateDir: path.join(mainRoot, ".fx"),
  };
};

/** The checked-out branch, or undefined when HEAD is detached. */
export const currentBranch = async (
  cwd: string
): Promise<string | undefined> => {
  const branch = await git(cwd, "branch", "--show-current");
  return branch || undefined;
};

/** True when the repo has a remote called origin. */
export const hasOrigin = async (cwd: string): Promise<boolean> => {
  const remotes = await git(cwd, "remote");
  return remotes.split("\n").includes("origin");
};
