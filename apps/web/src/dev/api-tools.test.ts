import { afterEach, describe, expect, it } from "vitest";

import { apiDevHooks, apiTools, forcedError } from "./api-tools.ts";

describe("the API menu's hooks", () => {
  afterEach(() => {
    apiTools.setDryRun(false);
    apiTools.setFailNext(null);
    apiTools.clear();
  });

  it("sends only actions as dry runs", async () => {
    apiTools.setDryRun(true);
    await expect(
      apiDevHooks.before("/actions/contact.create")
    ).resolves.toStrictEqual({ dryRun: true });
    await expect(
      apiDevHooks.before("/queries/contact.list")
    ).resolves.toStrictEqual({ dryRun: false });
  });

  it("fails just the next call with the chosen error", async () => {
    apiTools.setFailNext("conflict");
    await expect(
      apiDevHooks.before("/actions/contact.update")
    ).resolves.toStrictEqual({ fail: forcedError("conflict") });
    expect(apiTools.read().failNext).toBeNull();
    expect(forcedError("conflict").status).toBe(409);
  });

  it("keeps the newest calls first", () => {
    const call = {
      path: "/x",
      status: 200,
      ms: 1,
      dryRun: false,
      forced: false,
    };
    apiDevHooks.after({ ...call, at: 1 });
    apiDevHooks.after({ ...call, at: 2 });
    expect(apiTools.read().calls.map((item) => item.at)).toStrictEqual([2, 1]);
  });
});
