import { mkdtempSync, readdirSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import {
  changeForPath,
  findChange,
  listChanges,
  removeChange,
  saveChange,
} from "./state.ts";
import type { Change } from "./state.ts";

const tempStateDir = () =>
  path.join(mkdtempSync(path.join(tmpdir(), "fx-state-")), ".fx");

const change = (slug: string, createdAt: string): Change => ({
  name: slug.replaceAll("-", " "),
  slug,
  branch: `change/${slug}`,
  worktree: `/work/factory.worktrees/${slug}`,
  database: `factory_${slug.replaceAll("-", "_")}`,
  createdAt,
  lastCheck: null,
});

describe("state file", () => {
  it("has no changes before anything is saved", async () => {
    await expect(listChanges(tempStateDir())).resolves.toStrictEqual([]);
  });

  it("round-trips a change", async () => {
    const stateDir = tempStateDir();
    const saved: Change = {
      ...change("deal-pipeline", "2026-11-06T10:00:00.000Z"),
      lastCheck: {
        passed: true,
        at: "2026-11-06T11:00:00.000Z",
        commit: "abc1234",
      },
    };
    await saveChange(stateDir, saved);
    await expect(findChange(stateDir, "deal-pipeline")).resolves.toStrictEqual(
      saved
    );
    await expect(findChange(stateDir, "missing")).resolves.toBeUndefined();
  });

  it("lists changes oldest first", async () => {
    const stateDir = tempStateDir();
    await saveChange(stateDir, change("newer", "2026-11-06T12:00:00.000Z"));
    await saveChange(stateDir, change("older", "2026-11-05T12:00:00.000Z"));
    const changes = await listChanges(stateDir);
    const slugs = changes.map((c) => c.slug);
    expect(slugs).toStrictEqual(["older", "newer"]);
  });

  it("writes atomically, leaving no temporary files", async () => {
    const stateDir = tempStateDir();
    await saveChange(stateDir, change("a", "2026-11-06T12:00:00.000Z"));
    await saveChange(stateDir, change("a", "2026-11-06T13:00:00.000Z"));
    expect(readdirSync(path.join(stateDir, "changes"))).toStrictEqual([
      "a.json",
    ]);
  });

  it("removes a change", async () => {
    const stateDir = tempStateDir();
    await saveChange(stateDir, change("a", "2026-11-06T12:00:00.000Z"));
    await removeChange(stateDir, "a");
    await expect(listChanges(stateDir)).resolves.toStrictEqual([]);
  });

  it.each([
    ["not json", /not valid JSON/u],
    [JSON.stringify({ name: "x" }), /not a valid change/u],
    [
      JSON.stringify({ ...change("x", "t"), lastCheck: { passed: "yes" } }),
      /not a valid change/u,
    ],
  ])("refuses a broken file: %s", async (contents, message) => {
    const stateDir = tempStateDir();
    mkdirSync(path.join(stateDir, "changes"), { recursive: true });
    writeFileSync(path.join(stateDir, "changes", "x.json"), contents);
    await expect(listChanges(stateDir)).rejects.toThrow(message);
    await expect(listChanges(stateDir)).rejects.toMatchObject({
      code: "state_invalid",
    });
  });
});

describe(changeForPath, () => {
  const changes = [change("deal", "t"), change("deal-two", "t")];

  it("matches the worktree and folders inside it", () => {
    expect(changeForPath(changes, "/work/factory.worktrees/deal")?.slug).toBe(
      "deal"
    );
    expect(
      changeForPath(changes, "/work/factory.worktrees/deal/packages/db")?.slug
    ).toBe("deal");
  });

  it("does not match a sibling whose name starts the same", () => {
    expect(
      changeForPath(changes, "/work/factory.worktrees/deal-two")?.slug
    ).toBe("deal-two");
    expect(changeForPath(changes, "/work/factory")).toBeUndefined();
  });
});
