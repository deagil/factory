import { describe, expect, it } from "vitest";

import { setEnvValue } from "./env-file.ts";
import { branchName, databaseName, slugify } from "./names.ts";

describe(slugify, () => {
  it.each([
    ["deal pipeline", "deal-pipeline"],
    ["Deal Pipeline (v2)", "deal-pipeline-v2"],
    ["  refunds!! ", "refunds"],
    ["Café crème", "cafe-creme"],
    ["a".repeat(60), "a".repeat(40)],
    [`${"a".repeat(39)} b`, "a".repeat(39)],
  ])("%j becomes %j", (name, slug) => {
    expect(slugify(name)).toBe(slug);
  });

  it("refuses a name with nothing to slug", () => {
    expect(() => slugify("!!!")).toThrow(
      expect.objectContaining({ code: "usage" })
    );
  });
});

describe("names", () => {
  it("names the branch and database", () => {
    expect(branchName("try-it")).toBe("change/try-it");
    expect(databaseName("factory", "try-it")).toBe("factory_try_it");
    expect(databaseName("acme-crm", "try-it")).toBe("acme_crm_try_it");
  });
});

describe(setEnvValue, () => {
  it("replaces an existing value", () => {
    expect(
      setEnvValue("A=1\nDATABASE_URL=old\nB=2\n", "DATABASE_URL", "new")
    ).toBe("A=1\nDATABASE_URL=new\nB=2\n");
  });

  it("appends a missing value", () => {
    expect(setEnvValue("A=1", "DATABASE_URL", "new")).toBe(
      "A=1\nDATABASE_URL=new\n"
    );
    expect(setEnvValue("", "DATABASE_URL", "new")).toBe("DATABASE_URL=new\n");
  });
});
