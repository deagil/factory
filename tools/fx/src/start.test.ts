import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

import {
  databaseUrl,
  listDatabases,
  withAdmin,
} from "@workspace/testing/databases";
import { Client } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { start } from "./commands/start.ts";
import { listChanges } from "./state.ts";
import type { Change } from "./state.ts";
import { gitAs as run, removeTempRepos, tempRepo } from "./test-repo.ts";

const quiet = { log: () => {} };

const changeUrl = (change: Change) =>
  databaseUrl(process.env.DATABASE_ADMIN_URL ?? "", change.database);

describe("fx start", () => {
  afterAll(removeTempRepos);

  describe("on success", () => {
    let repo: string;
    let worktree: string;
    let change: Change;

    beforeAll(async () => {
      const temp = tempRepo();
      ({ repo } = temp);
      worktree = path.join(temp.parent, `${temp.repoName}.worktrees`, "try-it");
      change = await start(repo, "Try it", { ...quiet, skipInstall: true });
    }, 30_000);

    it("records the change in .fx", async () => {
      expect(change).toMatchObject({
        name: "Try it",
        slug: "try-it",
        branch: "change/try-it",
        worktree,
        lastCheck: null,
      });
      const changes = await listChanges(path.join(repo, ".fx"));
      expect(changes).toStrictEqual([change]);
    });

    it("checks out a new branch from origin/main in the worktree", () => {
      expect(run(worktree, "branch", "--show-current")).toBe("change/try-it");
      expect(run(worktree, "rev-parse", "HEAD")).toBe(
        run(repo, "rev-parse", "origin/main")
      );
    });

    it("points the worktree's .env at the change's database", () => {
      const env = readFileSync(path.join(worktree, ".env"), "utf-8");
      expect(env).toContain(`DATABASE_URL=${changeUrl(change)}`);
      expect(env).toContain("OTHER=kept");
    });

    it("creates a migrated database for the change", async () => {
      const client = new Client({ connectionString: changeUrl(change) });
      await client.connect();
      const { rows } = await client.query(
        "select count(*)::int as n from users"
      );
      await client.end();
      expect(rows).toStrictEqual([{ n: 0 }]);
    });
  });

  it(
    "gives a clear error when the change already exists",
    { timeout: 30_000 },
    async () => {
      const { repo } = tempRepo();
      await start(repo, "try it", { ...quiet, skipInstall: true });
      await expect(
        start(repo, "Try it!", { ...quiet, skipInstall: true })
      ).rejects.toMatchObject({
        code: "change_exists",
        message: 'A change called "try-it" is already open.',
      });
    }
  );

  it("refuses to start with uncommitted changes", async () => {
    const { repo } = tempRepo();
    writeFileSync(path.join(repo, "notes.txt"), "wip");
    await expect(
      start(repo, "try it", { ...quiet, skipInstall: true })
    ).rejects.toMatchObject({
      code: "dirty_worktree",
      hint: expect.stringContaining("git stash -u"),
    });
  });

  it("undoes everything when a step fails", { timeout: 60_000 }, async () => {
    const { repo, repoName, parent } = tempRepo();
    // No package.json, so install fails after the database exists. pnpm 12
    // itself can exit 0 there; fx start treats the missing manifest as failure.
    await expect(start(repo, "try it", quiet)).rejects.toMatchObject({
      code: "command_failed",
      message: expect.stringContaining("pnpm install failed"),
    });

    expect(
      existsSync(path.join(parent, `${repoName}.worktrees`, "try-it"))
    ).toBeFalsy();
    expect(run(repo, "branch", "--list", "change/try-it")).toBe("");
    const left = await withAdmin((client) =>
      listDatabases(client, `${repoName}_`)
    );
    expect(left).toStrictEqual([]);
    await expect(listChanges(path.join(repo, ".fx"))).resolves.toStrictEqual(
      []
    );
  });
});
