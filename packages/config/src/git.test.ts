import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import {
  coreConfigTypes,
  createConfigLoader,
  createGitConfigService,
} from "./index.ts";
import type { ConfigCatalog } from "./index.ts";

const catalog: ConfigCatalog = {
  objects: new Map([["contact", ["firstName"]]]),
  actions: new Set(),
  objectActions: new Map(),
  events: new Set(),
  choiceLists: [],
};

const env = {
  ...process.env,
  GIT_CONFIG_GLOBAL: "/dev/null",
  GIT_CONFIG_NOSYSTEM: "1",
  GIT_AUTHOR_NAME: "Dev",
  GIT_AUTHOR_EMAIL: "dev@example.com",
  GIT_COMMITTER_NAME: "Dev",
  GIT_COMMITTER_EMAIL: "dev@example.com",
};
const git = (cwd: string, ...args: string[]) =>
  execFileSync("git", args, {
    cwd,
    env,
    encoding: "utf-8",
    stdio: "pipe",
  }).trim();

const role = (key: string, can: string) =>
  `key: ${key}\nlabel: ${key}\npermissions:\n  - object: contact\n    can: [${can}]\n    scope: all\n`;

/** A bare remote whose main and production both have one role. */
const remote = () => {
  const root = mkdtempSync(path.join(tmpdir(), "config-git-"));
  const bare = path.join(root, "remote.git");
  git(root, "init", "--quiet", "--bare", "--initial-branch=main", bare);
  const work = path.join(root, "work");
  git(root, "clone", "--quiet", bare, work);
  mkdirSync(path.join(work, "config", "roles"), { recursive: true });
  writeFileSync(
    path.join(work, "config", "roles", "sales.yaml"),
    role("sales", "view")
  );
  writeFileSync(path.join(work, "README.md"), "code lives here\n");
  git(work, "add", ".");
  git(work, "commit", "--quiet", "-m", "seed");
  git(work, "push", "--quiet", "origin", "HEAD:main", "HEAD:production");
  const service = createGitConfigService({
    remote: bare,
    cacheDir: path.join(root, "cache.git"),
    types: coreConfigTypes,
    catalog: () => catalog,
  });
  const show = (ref: string, file: string) =>
    git(bare, "show", `${ref}:${file}`);
  return { bare, work, service, show };
};

const author = { name: "Sarah", email: "sarah@example.com" };

describe(createGitConfigService, () => {
  it("publishes a two-file draft as one commit, which the loader and main pick up", async () => {
    const { bare, service, show } = remote();
    const base = await service.branch("draft/one");
    await service.commit({
      branch: "draft/one",
      path: "config/roles/sales.yaml",
      content: role("sales", "view, update"),
      message: "Edit sales",
      author,
    });
    await service.commit({
      branch: "draft/one",
      path: "config/roles/support.yaml",
      content: role("support", "view"),
      message: "Add support",
      author,
    });
    const draftHead = await service.head("draft/one");
    const check = await service.check(draftHead);
    const diff = await service.diff(base, draftHead);
    const result = await service.publish({
      branch: "draft/one",
      base,
      message: "Support role",
      author,
    });
    const loader = createConfigLoader({
      dir: path.join(tmpdir(), "no-working-tree"),
      source: service.source,
      types: coreConfigTypes,
      catalog: () => catalog,
      log: () => null,
    });
    const loaded = await loader.load();
    const files = ["config/roles/sales.yaml", "config/roles/support.yaml"];

    expect({
      check,
      diff: diff.map((each) => each.path),
      result,
      // One commit on production, by Sarah, on top of the old head.
      commits: git(bare, "rev-list", "--count", `${base}..production`),
      author: git(bare, "log", "-1", "--format=%an", "production"),
      // Main has the same files, and its code is untouched.
      main: files.map(
        (file) => show("main", file) === show("production", file)
      ),
      readme: show("main", "README.md"),
      draftBranch: git(bare, "branch", "--list", "draft/one"),
      // The loader runs the published commit.
      loaded,
      roles: loader.service.roles.map((each) => each.key),
    }).toMatchObject({
      check: { files: 2, problems: [] },
      diff: files,
      result: {
        status: "published",
        sha: git(bare, "rev-parse", "production"),
        synced: { status: "copied", sha: git(bare, "rev-parse", "main") },
      },
      commits: "1",
      author: "Sarah",
      main: [true, true],
      readme: "code lives here",
      draftBranch: "",
      loaded: { status: "loaded", sha: git(bare, "rev-parse", "production") },
      roles: ["sales", "support"],
    });
  });

  it("refuses a draft that doesn't validate, or touches a file production changed", async () => {
    const { work, service } = remote();
    const base = await service.branch("draft/bad");
    await service.commit({
      branch: "draft/bad",
      path: "config/roles/sales.yaml",
      content: role("sales", "fly"),
      message: "Break sales",
      author,
    });
    const invalid = await service.publish({
      branch: "draft/bad",
      base,
      message: "x",
      author,
    });
    expect(invalid.status).toBe("invalid");

    await service.commit({
      branch: "draft/bad",
      path: "config/roles/sales.yaml",
      content: role("sales", "view, create"),
      message: "Fix sales",
      author,
    });
    writeFileSync(
      path.join(work, "config", "roles", "sales.yaml"),
      role("sales", "view, archive")
    );
    git(work, "commit", "--quiet", "-am", "Someone else");
    git(work, "push", "--quiet", "origin", "HEAD:production");
    await expect(
      service.publish({ branch: "draft/bad", base, message: "x", author })
    ).resolves.toStrictEqual({
      status: "conflict",
      files: ["config/roles/sales.yaml"],
    });
  });

  it("releases only folders it checked out", async () => {
    const { service } = remote();
    const sha = await service.source.head();
    const dir = await service.source.checkout(sha);
    expect(existsSync(path.join(dir, "roles", "sales.yaml"))).toBeTruthy();
    const elsewhere = mkdtempSync(path.join(tmpdir(), "keep-"));
    service.source.release?.(path.join(elsewhere, "config"));
    expect(existsSync(elsewhere)).toBeTruthy();
    service.source.release?.(dir);
    expect(existsSync(dir)).toBeFalsy();
  });
});
