import { currentBranch, findRepo } from "../git.ts";
import { changeForPath, listChanges } from "../state.ts";
import type { Change } from "../state.ts";

export interface StatusReport {
  readonly repo: string;
  readonly worktree: string;
  readonly branch: string | null;
  readonly current: Change | null;
  readonly changes: readonly Change[];
}

/** Builds the status report for `cwd`. */
export const status = async (cwd: string): Promise<StatusReport> => {
  const repo = await findRepo(cwd);
  const changes = await listChanges(repo.stateDir);
  return {
    repo: repo.name,
    worktree: repo.worktreeRoot,
    branch: (await currentBranch(repo.worktreeRoot)) ?? null,
    current: changeForPath(changes, repo.worktreeRoot) ?? null,
    changes,
  };
};

const age = (from: string, now: Date): string => {
  const minutes = Math.max(
    0,
    Math.round((now.getTime() - new Date(from).getTime()) / 60_000)
  );
  if (minutes < 60) {
    return `${minutes}m`;
  }
  const hours = Math.round(minutes / 60);
  return hours < 48 ? `${hours}h` : `${Math.round(hours / 24)}d`;
};

const checks = (change: Change): string => {
  if (!change.lastCheck) {
    return "not run yet";
  }
  const result = change.lastCheck.passed ? "passed" : "failed";
  return `${result} on ${change.lastCheck.commit.slice(0, 7)} at ${change.lastCheck.at}`;
};

/** The human-readable form of a status report. */
export const formatStatus = (
  report: StatusReport,
  now: Date = new Date()
): string => {
  const lines: string[] = [];
  if (report.current) {
    const { current } = report;
    lines.push(
      `Change: ${current.name}`,
      `  branch    ${current.branch}`,
      `  database  ${current.database}`,
      `  worktree  ${current.worktree}`,
      `  checks    ${checks(current)}`
    );
  } else {
    lines.push(
      `No current change: ${report.worktree} is on ${report.branch ?? "a detached HEAD"}.`
    );
  }
  const others = report.changes.filter(
    (change) => change.slug !== report.current?.slug
  );
  lines.push("");
  if (others.length === 0) {
    lines.push(
      report.current
        ? "No other open changes."
        : 'No open changes. Start one with `fx start "<name>"`.'
    );
  } else {
    lines.push("Open changes:");
    for (const change of others) {
      lines.push(
        `  ${change.slug.padEnd(24)} ${age(change.createdAt, now).padStart(4)}  checks ${checks(change)}`
      );
    }
  }
  return `${lines.join("\n")}\n`;
};
