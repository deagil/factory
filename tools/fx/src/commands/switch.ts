import { existsSync } from "node:fs";
import path from "node:path";

import { FxError } from "../errors.ts";
import { findRepo } from "../git.ts";
import { slugify } from "../names.ts";
import { findChange, listChanges } from "../state.ts";
import type { Change } from "../state.ts";

/** The open change called `name`, or a change_not_found error that lists them. */
export const requireChange = async (
  stateDir: string,
  name: string
): Promise<Change> => {
  const slug = slugify(name);
  const change = await findChange(stateDir, slug);
  if (change) {
    return change;
  }
  const open = await listChanges(stateDir);
  throw new FxError(
    "change_not_found",
    `No open change called "${slug}".`,
    open.length > 0
      ? `Open changes: ${open.map((each) => each.slug).join(", ")}.`
      : 'Start one with `fx start "<name>"`.'
  );
};

export interface SwitchResult {
  readonly change: Change;
  /** The directory to cd into. */
  readonly cd: string;
}

/**
 * `fx switch <name>`: finds another change's worktree. A command can't
 * change its shell's directory, so it says where to cd.
 */
export const switchTo = async (
  cwd: string,
  name: string
): Promise<SwitchResult> => {
  const repo = await findRepo(cwd);
  const change = await requireChange(repo.stateDir, name);
  if (!existsSync(change.worktree)) {
    throw new FxError(
      "state_invalid",
      `${change.worktree}, the worktree of "${change.slug}", no longer exists.`,
      `Clear the change away with \`fx done ${change.slug} --force\`.`
    );
  }
  return { change, cd: change.worktree };
};

/** The human-readable result of `fx switch`. */
export const formatSwitch = (result: SwitchResult, from: string): string =>
  [
    `"${result.change.name}" is on ${result.change.branch}, in ${result.change.worktree}.`,
    "",
    `  cd ${path.relative(from, result.cd) || "."}`,
    "",
    'Or in one step: cd "$(pnpm --silent fx switch ' +
      `${result.change.slug} --path)"`,
    "",
  ].join("\n");
