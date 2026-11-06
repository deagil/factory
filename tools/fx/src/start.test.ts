import { execFileSync } from "node:child_process";
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import {
  coreMigrationsFolder,
  databaseUrl,
  dropDatabase,
  listDatabases,
  withAdmin,
} from "@workspace/testing/databases";
import { Client } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { start } from "./commands/start.ts";
import { listChanges } from "./state.ts";
import type { Change } from "./state.ts";

const run = (cwd: string, ...args: string[]) =>
  execFileSync(
    "git",
    ["-c", "user.email=t@example.com", "-c", "user.name=T", ...args],
    { cwd, encoding: "utf-8" }
  ).trim();

const created: { parent: string; repoName: string }[] = [];

/** A repo with the core migrations, pushed to a bare origin. */
const tempRepo = () => {
  const parent = realpathSync(mkdtempSync(path.join(tmpdir(), "fx-start-")));
  const repoName = `fxtest${Math.random().toString(36).slice(2, 8)}`;
  const repo = path.join(parent, repoName);
  const origin = path.join(parent, "origin.git");
  execFileSync("git", ["init", "-q", "--bare", "-b", "main", origin]);
  execFileSync("git", ["init", "-q", "-b", "main", repo]);
  mkdirSync(path.join(repo, "packages", "db"), { recursive: true });
  cpSync(
    coreMigrationsFolder,
    path.join(repo, "packages", "db", "migrations"),
    {
      recursive: true,
    }
  );
  writeFileSync(
    path.join(repo, ".env.example"),
    "DATABASE_URL=placeholder\nOTHER=kept\n"
  );
  writeFileSync(path.join(repo, ".gitignore"), ".fx/\n.env\n");
  run(repo, "add", "-A");
  run(repo, "commit", "-q", "-m", "init");
  run(repo, "remote", "add", "origin", origin);
  run(repo, "push", "-q", "origin", "main");
  created.push({ parent, repoName });
  return { repo, repoName, parent };
};

const quiet = { log: () => {} };

const changeUrl = (change: Change) =>
  databaseUrl(process.env.DATABASE_ADMIN_URL ?? "", change.database);

describe("fx start", () => {
  afterAll(async () => {
    // One query per connection: pg doesn't allow concurrent queries on one client.
    const names = await withAdmin((client) => listDatabases(client, "fxtest"));
    const ours = names.filter((name) =>
      created.some(({ repoName }) => name.startsWith(`${repoName}_`))
    );
    await Promise.all(
      ours.map((name) => withAdmin((client) => dropDatabase(client, name)))
    );
    for (const { parent } of created) {
      rmSync(parent, { recursive: true, force: true });
    }
  });

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
    // No package.json, so pnpm install fails after the database exists.
    await expect(start(repo, "try it", quiet)).rejects.toMatchObject({
      code: "command_failed",
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
