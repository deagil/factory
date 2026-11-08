import { execFileSync } from "node:child_process";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { beforeAll, describe, expect, it } from "vitest";

import {
  compareUrl,
  contractReason,
  migrationName,
  migrationsPath,
  migrationTargets,
  runGenerate,
  pullRequestCopy,
  pullRequestMessages,
  ship,
  webUrl,
  withContractStep,
} from "./commands/ship.ts";
import type {
  Check,
  Generate,
  PullRequest,
  ShipOptions,
} from "./commands/ship.ts";
import { findChange, saveChange } from "./state.ts";

const git = (cwd: string, ...args: string[]) =>
  execFileSync("git", args, { cwd, encoding: "utf-8" }).trim();

const write = (file: string, text: string) => {
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, text);
};

interface Journal {
  entries: { idx: number; tag: string }[];
}

const journalFile = (root: string) =>
  path.join(root, migrationsPath, "meta", "_journal.json");

const readJournal = (root: string): Journal =>
  JSON.parse(readFileSync(journalFile(root), "utf-8")) as Journal;

/** Adds migration `<idx>_<name>` recording `schema`, like drizzle-kit does. */
const addMigration = (root: string, name: string, schema: string): string => {
  const journal = readJournal(root);
  const idx = journal.entries.length;
  const tag = `${String(idx).padStart(4, "0")}_${name}`;
  write(
    path.join(root, migrationsPath, `${tag}.sql`),
    `alter table a add column x text;\n-- schema: ${schema}\n`
  );
  write(
    path.join(
      root,
      migrationsPath,
      "meta",
      `${String(idx).padStart(4, "0")}_snapshot.json`
    ),
    JSON.stringify({ schema })
  );
  journal.entries.push({ idx, tag });
  write(journalFile(root), JSON.stringify(journal));
  return tag;
};

/**
 * Stands in for drizzle-kit: `schema.txt` is the schema, and each migration
 * records the schema it brings the database to. A migration is written when
 * the schema differs from the latest one's.
 */
const fakeGenerate: Generate = (worktree, name) => {
  const schema = readFileSync(path.join(worktree, "schema.txt"), "utf-8");
  const last = readJournal(worktree).entries.at(-1);
  const recorded = last
    ? readFileSync(
        path.join(worktree, migrationsPath, `${last.tag}.sql`),
        "utf-8"
      )
    : "";
  return Promise.resolve(
    recorded.includes(`-- schema: ${schema}\n`)
      ? []
      : [
          path.join(
            migrationsPath,
            `${addMigration(worktree, name, schema)}.sql`
          ),
        ]
  );
};

const passing: Check[] = [
  { name: "fake check", command: [process.execPath, "-e", "process.exit(0)"] },
];
const failing: Check[] = [
  { name: "fake check", command: [process.execPath, "-e", "process.exit(1)"] },
];

/** A main checkout with a bare origin, and a change worktree like fx start leaves. */
const shipRepo = async () => {
  const parent = realpathSync(mkdtempSync(path.join(tmpdir(), "fx-ship-")));
  const origin = path.join(parent, "origin.git");
  const repo = path.join(parent, "factory");
  const worktree = path.join(parent, "factory.worktrees", "try-it");
  execFileSync("git", ["init", "-q", "--bare", "-b", "main", origin]);
  execFileSync("git", ["init", "-q", "-b", "main", repo]);
  git(repo, "config", "user.email", "t@example.com");
  git(repo, "config", "user.name", "T");
  write(path.join(repo, ".gitignore"), ".fx/\n");
  write(journalFile(repo), JSON.stringify({ entries: [] }));
  write(path.join(repo, "schema.txt"), "a");
  addMigration(repo, "core", "a");
  git(repo, "add", "-A");
  git(repo, "commit", "-q", "-m", "init");
  git(repo, "remote", "add", "origin", origin);
  git(repo, "push", "-q", "origin", "main");
  git(repo, "worktree", "add", "-q", "-b", "change/try-it", worktree, "main");
  await saveChange(path.join(repo, ".fx"), {
    name: "try it",
    slug: "try-it",
    branch: "change/try-it",
    worktree,
    database: "factory_try_it",
    createdAt: "2026-11-06T10:00:00.000Z",
    lastCheck: null,
  });
  return { repo, worktree };
};

const commitSchema = (worktree: string, schema: string, subject: string) => {
  write(path.join(worktree, "schema.txt"), schema);
  git(worktree, "commit", "-q", "-am", subject);
};

/** Migration files the branch adds on top of origin/main. */
const addedMigrations = (worktree: string) =>
  git(
    worktree,
    "diff",
    "--name-only",
    "--diff-filter=A",
    "origin/main...HEAD",
    "--",
    migrationsPath
  ).split("\n");

const shipWith = (
  pullRequests: string[],
  extra: ShipOptions = {}
): ShipOptions => ({
  log: () => {},
  generate: fakeGenerate,
  checks: passing,
  openPullRequest: (_worktree, branch): Promise<PullRequest> => {
    pullRequests.push(branch);
    return Promise.resolve({
      url: "https://git.example.test/pr/1",
      created: pullRequests.length === 1,
    });
  },
  ...extra,
});

describe("fx ship", { timeout: 30_000 }, () => {
  describe("shipping a change twice", () => {
    let repo: string;
    let worktree: string;
    const pullRequests: string[] = [];

    beforeAll(async () => {
      ({ repo, worktree } = await shipRepo());
      commitSchema(worktree, "a+b", "feat: add b");
      await ship(worktree, shipWith(pullRequests));
      commitSchema(worktree, "a+b+c", "feat: add c");
    });

    it("pushes one migration and records the checks", async () => {
      expect(git(repo, "ls-remote", "origin", "change/try-it")).toContain(
        git(worktree, "rev-parse", "HEAD~1")
      );
      expect(addedMigrations(worktree)).toStrictEqual([
        "packages/db/migrations/0001_try_it.sql",
        "packages/db/migrations/meta/0001_snapshot.json",
      ]);
      await expect(
        findChange(path.join(repo, ".fx"), "try-it")
      ).resolves.toMatchObject({ lastCheck: { passed: true } });
    });

    it("replaces the migration on the next ship instead of adding one", async () => {
      const result = await ship(worktree, shipWith(pullRequests));
      expect(result).toMatchObject({
        migrations: ["packages/db/migrations/0001_try_it.sql"],
        pushed: true,
        pullRequest: { created: false },
      });
      expect(addedMigrations(worktree)).toHaveLength(2);
      expect(
        readFileSync(
          path.join(worktree, migrationsPath, "0001_try_it.sql"),
          "utf-8"
        )
      ).toContain("-- schema: a+b+c");
      expect(
        git(worktree, "log", "--format=%s", "origin/main..HEAD").split("\n")
      ).toStrictEqual([
        "chore: migration for try it",
        "feat: add c",
        "feat: add b",
      ]);
    });
  });

  it("keeps the contract step on the next ship", async () => {
    const { worktree } = await shipRepo();
    commitSchema(worktree, "a-x", "feat: drop x");
    await ship(
      worktree,
      shipWith([], { contractStep: "x is unused since #12" })
    );
    commitSchema(worktree, "a-x+y", "feat: add y");
    const result = await ship(worktree, shipWith([]));
    expect(result.contractStep).toBe("x is unused since #12");
    expect(
      readFileSync(
        path.join(worktree, migrationsPath, "0001_try_it.sql"),
        "utf-8"
      )
    ).toMatch(/^-- contract-step: x is unused since #12\n/u);
  });

  it("renumbers its migration when main gained one", async () => {
    const { repo, worktree } = await shipRepo();
    commitSchema(worktree, "a+b", "feat: add b");
    await ship(worktree, shipWith([]));

    // Someone else's change lands on main first, with migration 0001.
    write(path.join(repo, "other.txt"), "other");
    addMigration(repo, "other", "a+other");
    git(repo, "add", "-A");
    git(repo, "commit", "-q", "-m", "feat: other");
    git(repo, "push", "-q", "origin", "main");

    const result = await ship(worktree, shipWith([]));
    expect(result.migrations).toStrictEqual([
      "packages/db/migrations/0002_try_it.sql",
    ]);
    expect(addedMigrations(worktree)).toStrictEqual([
      "packages/db/migrations/0002_try_it.sql",
      "packages/db/migrations/meta/0002_snapshot.json",
    ]);
  });

  it("pushes, then reports a failed GitHub check", async () => {
    const { repo, worktree } = await shipRepo();
    commitSchema(worktree, "a+b", "feat: add b");
    await expect(
      ship(
        worktree,
        shipWith([], {
          watchRemoteCheck: () =>
            Promise.resolve({
              state: "failed",
              url: "https://github.com/acme/factory/actions/runs/1",
              detail: "TypeError: boom",
            }),
        })
      )
    ).rejects.toMatchObject({
      code: "checks_failed",
      message: expect.stringContaining(
        "https://github.com/acme/factory/actions/runs/1"
      ),
    });
    expect(git(repo, "ls-remote", "origin", "change/try-it")).not.toBe("");
  });

  it("records a passing GitHub check on the result", async () => {
    const { worktree } = await shipRepo();
    commitSchema(worktree, "a+b", "feat: add b");
    const result = await ship(
      worktree,
      shipWith([], {
        watchRemoteCheck: () =>
          Promise.resolve({
            state: "passed",
            url: "https://github.com/acme/factory/actions/runs/2",
            detail: null,
          }),
      })
    );
    expect(result.remoteCheck).toStrictEqual({
      state: "passed",
      url: "https://github.com/acme/factory/actions/runs/2",
      detail: null,
    });
  });

  it("records failed checks and doesn't push", async () => {
    const { repo, worktree } = await shipRepo();
    commitSchema(worktree, "a+b", "feat: add b");
    await expect(
      ship(worktree, shipWith([], { checks: failing }))
    ).rejects.toMatchObject({ code: "checks_failed" });
    expect(git(repo, "ls-remote", "origin", "change/try-it")).toBe("");
    await expect(
      findChange(path.join(repo, ".fx"), "try-it")
    ).resolves.toMatchObject({ lastCheck: { passed: false } });
  });

  it("refuses uncommitted changes", async () => {
    const { worktree } = await shipRepo();
    write(path.join(worktree, "schema.txt"), "a+b");
    await expect(ship(worktree, shipWith([]))).rejects.toMatchObject({
      code: "dirty_worktree",
    });
  });

  it("refuses migrations edited by hand", async () => {
    const { worktree } = await shipRepo();
    addMigration(worktree, "by_hand", "a+b");
    git(worktree, "add", "-A");
    git(worktree, "commit", "-q", "-m", "feat: hand-written migration");
    await expect(ship(worktree, shipWith([]))).rejects.toMatchObject({
      code: "migration_failed",
      message: expect.stringContaining("0001_by_hand.sql"),
    });
  });

  it("refuses a change with no commits", async () => {
    const { worktree } = await shipRepo();
    await expect(ship(worktree, shipWith([]))).rejects.toMatchObject({
      code: "nothing_to_ship",
    });
  });
});

describe(migrationTargets, () => {
  it("lists the core's migrations, then each system's", async () => {
    const root = realpathSync(mkdtempSync(path.join(tmpdir(), "fx-targets-")));
    write(
      path.join(root, "examples", "shop", "package.json"),
      JSON.stringify({ factory: { system: "./src/system.ts" } })
    );
    write(path.join(root, "examples", "shop", "drizzle.config.ts"), "");
    // A system with no drizzle config has no migrations of its own.
    write(
      path.join(root, "examples", "bare", "package.json"),
      JSON.stringify({ factory: { system: "./src/system.ts" } })
    );
    await expect(migrationTargets(root)).resolves.toStrictEqual([
      { dir: "packages/db", migrations: "packages/db/migrations" },
      { dir: "examples/shop", migrations: "examples/shop/migrations" },
    ]);
  });
});

describe(runGenerate, () => {
  it(
    "returns the new migration's tag, then nothing once it exists",
    { timeout: 60_000 },
    async () => {
      const dbDir = path.resolve(import.meta.dirname, "../../../packages/db");
      const out = mkdtempSync(path.join(tmpdir(), "fx-generate-"));
      // drizzle-kit mishandles an absolute --out on its second run.
      const args = [
        "drizzle-kit",
        "generate",
        "--dialect",
        "postgresql",
        "--schema",
        "./src/schema/core.ts",
        "--out",
        path.relative(dbDir, out),
        "--name",
        "probe",
      ];
      await expect(runGenerate(dbDir, out, args)).resolves.toBe("0000_probe");
      await expect(runGenerate(dbDir, out, args)).resolves.toBeUndefined();
    }
  );
});

describe(withContractStep, () => {
  it("adds, replaces and reads the marker", () => {
    const sql = "ALTER TABLE a DROP COLUMN x;\n";
    const marked = withContractStep(sql, "x is unused");
    expect(marked).toBe(
      "-- contract-step: x is unused\nALTER TABLE a DROP COLUMN x;\n"
    );
    expect(contractReason(marked)).toBe("x is unused");
    expect(contractReason(withContractStep(marked, "new reason"))).toBe(
      "new reason"
    );
    expect(withContractStep(marked, undefined)).toBe(sql);
  });
});

describe(compareUrl, () => {
  it.each([
    ["git@github.com:deagil/factory.git", "https://github.com/deagil/factory"],
    [
      "https://github.com/deagil/factory.git",
      "https://github.com/deagil/factory",
    ],
    [
      "ssh://git@git.example.com/team/factory.git",
      "https://git.example.com/team/factory",
    ],
  ])("finds the web address of %s", (remote, web) => {
    expect(webUrl(remote)).toBe(web);
    expect(compareUrl(remote, "main", "change/x")).toBe(
      `${web}/compare/main...change/x?expand=1`
    );
  });

  it("has none for a local path", () => {
    expect(webUrl("/srv/git/factory.git")).toBeUndefined();
  });
});

describe(pullRequestMessages, () => {
  it("counts from origin/main, not a local main that has fallen behind", async () => {
    const { repo, worktree } = await shipRepo();
    write(path.join(repo, "other.txt"), "x");
    git(repo, "add", "-A");
    git(repo, "commit", "-q", "-m", "feat: someone else's change");
    git(repo, "push", "-q", "origin", "main");
    git(repo, "reset", "-q", "--hard", "HEAD~1");
    git(worktree, "rebase", "-q", "origin/main");
    commitSchema(worktree, "b", "feat: add b");
    await expect(pullRequestMessages(worktree, "main")).resolves.toStrictEqual([
      "feat: add b",
    ]);
  });
});

describe(pullRequestCopy, () => {
  it("titles the pull request from the first commit and keeps every commit in the body", () => {
    expect(
      pullRequestCopy(["feat: add b\n\nThe whole change.", "fix: later"])
    ).toStrictEqual({
      title: "feat: add b",
      body: "feat: add b\n\nThe whole change.\n\nfix: later",
    });
  });
});

describe(migrationName, () => {
  it("uses the slug in snake case", () => {
    expect(migrationName("deal-pipeline")).toBe("deal_pipeline");
  });
});
