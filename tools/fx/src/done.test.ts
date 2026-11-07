import { existsSync, writeFileSync } from "node:fs";
import path from "node:path";

import { listDatabases, withAdmin } from "@workspace/testing/databases";
import { afterAll, describe, expect, it } from "vitest";

import { done, staleTemplates } from "./commands/done.ts";
import { start } from "./commands/start.ts";
import { switchTo } from "./commands/switch.ts";
import { listChanges } from "./state.ts";
import { gitAs, removeTempRepos, tempRepo } from "./test-repo.ts";

const quiet = { log: () => {} };
const keepTemplates = { ...quiet, pruneTemplates: false };

/** A change with one commit, pushed to origin the way fx ship leaves it. */
const shippedChange = async () => {
  const temp = tempRepo();
  const change = await start(temp.repo, "try it", {
    ...quiet,
    skipInstall: true,
  });
  writeFileSync(path.join(change.worktree, "feature.txt"), "new\n");
  gitAs(change.worktree, "add", "-A");
  gitAs(change.worktree, "commit", "-q", "-m", "feat: try it");
  gitAs(change.worktree, "push", "-q", "origin", change.branch);
  return { ...temp, change };
};

/** Lands the change on origin/main as one squashed commit, like a PR merge. */
const squashMerge = (repo: string, branch: string) => {
  gitAs(repo, "merge", "-q", "--squash", branch);
  gitAs(repo, "commit", "-q", "-m", "feat: try it (#1)");
  gitAs(repo, "push", "-q", "origin", "main");
};

const databasesOf = (repoName: string) =>
  withAdmin((client) => listDatabases(client, `${repoName}_`));

describe("fx done", () => {
  afterAll(removeTempRepos);

  it(
    "removes a squash-merged change and everything it made",
    { timeout: 30_000 },
    async () => {
      const { repo, repoName, change } = await shippedChange();
      squashMerge(repo, change.branch);

      // Run from inside the worktree it removes.
      const result = await done(change.worktree, undefined, keepTemplates);
      expect(result).toMatchObject({
        merged: true,
        deletedRemoteBranch: true,
        cd: repo,
      });
      expect(existsSync(change.worktree)).toBeFalsy();
      expect(gitAs(repo, "branch", "--list", change.branch)).toBe("");
      await expect(databasesOf(repoName)).resolves.toStrictEqual([]);
      await expect(listChanges(path.join(repo, ".fx"))).resolves.toStrictEqual(
        []
      );
    }
  );

  it(
    "refuses an unmerged change, and throws it away with --force",
    { timeout: 30_000 },
    async () => {
      const { repo, change } = await shippedChange();
      await expect(done(repo, "try it", keepTemplates)).rejects.toMatchObject({
        code: "change_not_merged",
        hint: expect.stringContaining("fx done try-it --force"),
      });

      const result = await done(repo, "try it", {
        ...keepTemplates,
        force: true,
      });
      expect(result).toMatchObject({
        merged: false,
        deletedRemoteBranch: false,
      });
      expect(existsSync(change.worktree)).toBeFalsy();
      expect(result.main).toBeNull();
      // origin keeps an unmerged branch: fx done only deletes merged ones.
      expect(
        gitAs(repo, "ls-remote", "--heads", "origin", change.branch)
      ).not.toBe("");
    }
  );

  it("refuses uncommitted work", { timeout: 30_000 }, async () => {
    const temp = tempRepo();
    const change = await start(temp.repo, "try it", {
      ...quiet,
      skipInstall: true,
    });
    writeFileSync(path.join(change.worktree, "notes.txt"), "wip\n");
    await expect(
      done(temp.repo, "try it", keepTemplates)
    ).rejects.toMatchObject({ code: "dirty_worktree" });
  });

  it(
    "fast-forwards a clean main checkout that is behind origin/main",
    { timeout: 30_000 },
    async () => {
      const { repo, change } = await shippedChange();
      squashMerge(repo, change.branch);
      gitAs(repo, "reset", "--hard", "HEAD~1");
      const before = gitAs(repo, "rev-parse", "HEAD");

      const result = await done(change.worktree, undefined, keepTemplates);

      expect(result.main).toStrictEqual({
        fastForwarded: true,
        installed: false,
        note: null,
      });
      expect(gitAs(repo, "rev-parse", "HEAD")).not.toBe(before);
      expect(gitAs(repo, "rev-parse", "HEAD")).toBe(
        gitAs(repo, "rev-parse", "origin/main")
      );
    }
  );

  it(
    "installs in the main checkout when the lockfile changed",
    { timeout: 30_000 },
    async () => {
      const { repo, change } = await shippedChange();
      writeFileSync(path.join(change.worktree, "pnpm-lock.yaml"), "lock: 1\n");
      gitAs(change.worktree, "add", "pnpm-lock.yaml");
      gitAs(change.worktree, "commit", "-q", "-m", "chore: lockfile");
      gitAs(change.worktree, "push", "-q", "origin", change.branch);
      squashMerge(repo, change.branch);
      gitAs(repo, "reset", "--hard", "HEAD~1");
      const installed: string[] = [];

      const result = await done(change.worktree, undefined, {
        ...keepTemplates,
        install: (cwd) => {
          installed.push(cwd);
          return Promise.resolve();
        },
      });

      expect(result.main).toStrictEqual({
        fastForwarded: true,
        installed: true,
        note: null,
      });
      expect(installed).toStrictEqual([repo]);
    }
  );

  it(
    "leaves a dirty main checkout where it is",
    { timeout: 30_000 },
    async () => {
      const { repo, change } = await shippedChange();
      squashMerge(repo, change.branch);
      gitAs(repo, "reset", "--hard", "HEAD~1");
      writeFileSync(path.join(repo, "wip.txt"), "x\n");
      const head = gitAs(repo, "rev-parse", "HEAD");

      const result = await done(change.worktree, undefined, keepTemplates);

      expect(gitAs(repo, "rev-parse", "HEAD")).toBe(head);
      expect(result.main?.fastForwarded).toBeFalsy();
      expect(result.main?.note).toContain("wip.txt");
      expect(existsSync(change.worktree)).toBeFalsy();
    }
  );
});

describe("fx switch", () => {
  afterAll(removeTempRepos);

  it("finds a change's worktree by name", { timeout: 30_000 }, async () => {
    const temp = tempRepo();
    const change = await start(temp.repo, "try it", {
      ...quiet,
      skipInstall: true,
    });
    await expect(switchTo(temp.repo, "Try it")).resolves.toMatchObject({
      cd: change.worktree,
    });
    await expect(switchTo(temp.repo, "nope")).rejects.toMatchObject({
      code: "change_not_found",
      hint: "Open changes: try-it.",
    });
  });
});

describe(staleTemplates, () => {
  it("keeps templates in use and ones still being built", () => {
    expect(
      staleTemplates(
        [
          "factory_template_aaaa",
          "factory_template_bbbb",
          "factory_template_cccc_build_1234",
        ],
        new Set(["factory_template_aaaa"])
      )
    ).toStrictEqual(["factory_template_bbbb"]);
  });
});
