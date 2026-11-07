// GitHub's `check` on a change's pull request. Local `fx ship` checks are a
// different run; this is the one branch protection waits for.

import { setTimeout as sleep } from "node:timers/promises";

import { FxError } from "./errors.ts";
import { git } from "./git.ts";
import { capture, plainText } from "./process.ts";

export interface RemoteCheck {
  readonly state: "pending" | "passed" | "failed";
  readonly url: string | null;
  /** The failing log, when the check failed and `gh` could read it. */
  readonly detail: string | null;
}

interface CheckRunJson {
  readonly name?: string;
  readonly status?: string;
  readonly conclusion?: string | null;
  readonly detailsUrl?: string;
}

interface PullRequestJson {
  readonly url?: string;
  readonly statusCheckRollup?: readonly CheckRunJson[] | null;
}

/** True when `gh` can be started from `cwd`. */
export const ghInstalled = async (cwd: string): Promise<boolean> => {
  try {
    const version = await capture("gh", ["--version"], { cwd });
    return version.code === 0;
  } catch {
    return false;
  }
};

const isGitHub = (remote: string): boolean => /github\.com[:/]/u.test(remote);

/** The `check` job inside a `gh pr view` payload. Pending when it has not finished. */
export const interpretRemoteCheck = (body: PullRequestJson): RemoteCheck => {
  const checks = body.statusCheckRollup ?? [];
  const check = checks.find((item) => item.name === "check");
  const url = check?.detailsUrl ?? body.url ?? null;
  if (!check || check.status !== "COMPLETED") {
    return { state: "pending", url, detail: null };
  }
  if (
    check.conclusion === "SUCCESS" ||
    check.conclusion === "NEUTRAL" ||
    check.conclusion === "SKIPPED"
  ) {
    return { state: "passed", url, detail: null };
  }
  return { state: "failed", url, detail: check.conclusion ?? "failed" };
};

const failedLog = async (
  cwd: string,
  detailsUrl: string | null
): Promise<string | null> => {
  const run = detailsUrl?.match(/\/runs\/(?<run>\d+)/u)?.groups?.run;
  if (!run) {
    return null;
  }
  const log = await capture("gh", ["run", "view", run, "--log-failed"], {
    cwd,
    timeoutMs: 60_000,
  });
  if (log.code !== 0 || log.stdout.trim() === "") {
    return null;
  }
  const lines = plainText(log.stdout)
    .split("\n")
    .filter((line) => line.trim() !== "");
  return lines.slice(-40).join("\n");
};

/**
 * The pull request's `check` right now, or null when this remote is not
 * GitHub, `gh` is missing, or there is no open pull request.
 */
export const readRemoteCheck = async (
  cwd: string,
  branch: string
): Promise<RemoteCheck | null> => {
  let remote: string;
  try {
    remote = await git(cwd, "remote", "get-url", "origin");
  } catch {
    return null;
  }
  if (!isGitHub(remote) || !(await ghInstalled(cwd))) {
    return null;
  }
  const view = await capture(
    "gh",
    ["pr", "view", branch, "--json", "statusCheckRollup,url"],
    { cwd }
  );
  if (view.code !== 0 || view.stdout.trim() === "") {
    return null;
  }
  let body: PullRequestJson;
  try {
    body = JSON.parse(view.stdout) as PullRequestJson;
  } catch {
    return null;
  }
  const result = interpretRemoteCheck(body);
  if (result.state !== "failed") {
    return result;
  }
  const detail = await failedLog(cwd, result.url);
  return { ...result, detail: detail ?? result.detail };
};

/**
 * Polls until `check` passes or fails. Null when there is nothing to watch.
 * Throws when it is still running after `timeoutMs`.
 */
export const watchRemoteCheck = async (
  cwd: string,
  branch: string,
  options: { readonly timeoutMs?: number; readonly intervalMs?: number } = {}
): Promise<RemoteCheck | null> => {
  const timeoutMs = options.timeoutMs ?? 15 * 60 * 1000;
  const intervalMs = options.intervalMs ?? 5000;
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    // oxlint-disable-next-line eslint/no-await-in-loop -- poll until the check finishes
    const latest = await readRemoteCheck(cwd, branch);
    if (!latest || latest.state !== "pending") {
      return latest;
    }
    if (Date.now() >= deadline) {
      throw new FxError(
        "checks_failed",
        `GitHub's check is still running${latest.url ? `: ${latest.url}` : ""}.`,
        "Merge only after it is green. `fx status` shows it."
      );
    }
    // oxlint-disable-next-line eslint/no-await-in-loop -- wait before the next poll
    await sleep(intervalMs);
  }
};
