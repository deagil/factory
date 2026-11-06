// Test helper, not a test: temporary repos shaped like the factory, with a
// bare origin, for the commands that need real git and Postgres.

import { execFileSync } from "node:child_process";
import {
  cpSync,
  mkdirSync,
  mkdtempSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import {
  coreMigrationsFolder,
  dropDatabase,
  listDatabases,
  withAdmin,
} from "@workspace/testing/databases";

/** Runs git in `cwd` as a test user and returns trimmed stdout. */
export const gitAs = (cwd: string, ...args: string[]): string =>
  execFileSync(
    "git",
    ["-c", "user.email=t@example.com", "-c", "user.name=T", ...args],
    { cwd, encoding: "utf-8" }
  ).trim();

const created: { parent: string; repoName: string }[] = [];

/**
 * A repo with the core migrations, pushed to a bare origin. Its name starts
 * with `fxtest`, so its change databases do too.
 */
export const tempRepo = () => {
  const parent = realpathSync(mkdtempSync(path.join(tmpdir(), "fx-repo-")));
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
  gitAs(repo, "add", "-A");
  gitAs(repo, "commit", "-q", "-m", "init");
  gitAs(repo, "remote", "add", "origin", origin);
  gitAs(repo, "push", "-q", "origin", "main");
  created.push({ parent, repoName });
  return { repo, repoName, parent };
};

/** Drops the temp repos' databases and deletes their folders. Call in afterAll. */
export const removeTempRepos = async (): Promise<void> => {
  // One query per connection: pg doesn't allow concurrent queries on one client.
  const names = await withAdmin((client) => listDatabases(client, "fxtest"));
  const ours = names.filter((name) =>
    created.some(({ repoName }) => name.startsWith(`${repoName}_`))
  );
  await Promise.all(
    ours.map((name) => withAdmin((client) => dropDatabase(client, name)))
  );
  for (const { parent } of created.splice(0)) {
    rmSync(parent, { recursive: true, force: true });
  }
};
