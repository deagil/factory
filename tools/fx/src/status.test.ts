import { execFileSync } from "node:child_process";
import { mkdtempSync, realpathSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { describe, expect, it, vi } from "vitest";

import { formatStatus, status } from "./commands/status.ts";
import { run } from "./run.ts";
import { saveChange } from "./state.ts";

const tempRepo = () => {
  const root = realpathSync(mkdtempSync(path.join(tmpdir(), "fx-repo-")));
  const repo = path.join(root, "factory");
  execFileSync("git", ["init", "-q", "-b", "main", repo]);
  execFileSync("git", [
    "-C",
    repo,
    "-c",
    "user.email=t@example.com",
    "-c",
    "user.name=T",
    "commit",
    "-q",
    "--allow-empty",
    "-m",
    "init",
  ]);
  return repo;
};

describe("fx status", () => {
  it("reports no current change on main", async () => {
    const repo = tempRepo();
    const report = await status(repo);
    expect(report).toMatchObject({
      repo: "factory",
      branch: "main",
      current: null,
      changes: [],
    });
    expect(formatStatus(report)).toContain("No current change");
  });

  it("reports the change whose worktree it runs in", async () => {
    const repo = tempRepo();
    await saveChange(path.join(repo, ".fx"), {
      name: "deal pipeline",
      slug: "deal-pipeline",
      branch: "change/deal-pipeline",
      worktree: repo,
      database: "factory_deal_pipeline",
      createdAt: "2026-11-06T10:00:00.000Z",
      lastCheck: {
        passed: false,
        at: "2026-11-06T11:00:00.000Z",
        commit: "abcdef1234",
      },
    });
    const report = await status(path.join(repo));
    expect(report.current?.slug).toBe("deal-pipeline");
    const text = formatStatus(report);
    expect(text).toContain("database  factory_deal_pipeline");
    expect(text).toContain("checks    failed on abcdef1");
  });

  it("refuses to run outside a git repo", async () => {
    const outside = realpathSync(mkdtempSync(path.join(tmpdir(), "fx-none-")));
    await expect(status(outside)).rejects.toMatchObject({
      code: "not_in_repo",
    });
  });
});

describe(run, () => {
  it("prints status as JSON with --json", async () => {
    const repo = tempRepo();
    const write = vi.spyOn(process.stdout, "write").mockReturnValue(true);
    await expect(run(["status", "--json"], repo)).resolves.toBe(0);
    const output = JSON.parse(String(write.mock.calls[0]?.[0]));
    expect(output).toMatchObject({ ok: true, repo: "factory", current: null });
  });

  it("prints errors as JSON with --json and exits 2 for usage errors", async () => {
    const write = vi.spyOn(process.stdout, "write").mockReturnValue(true);
    await expect(run(["nope", "--json"])).resolves.toBe(2);
    const output = JSON.parse(String(write.mock.calls[0]?.[0]));
    expect(output).toStrictEqual({
      ok: false,
      error: {
        code: "usage",
        message: 'Unknown command "nope".',
        hint: "Run `fx --help` to see the commands.",
      },
    });
  });
});
