import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import {
  castProblems,
  commentProblems,
  dependencyProblems,
  readWorkspacePackages,
  sourceFiles,
  webImportProblems,
} from "./architecture.ts";
import type { WorkspacePackage } from "./architecture.ts";

const root = path.resolve(import.meta.dirname, "../../..");

/**
 * Files that still widen through a double cast. Remove an entry when the
 * cast goes, and don't add one without a reason a guard can't express.
 */
const castAllowlist = [
  "packages/actions/src/define-action.ts",
  "apps/web/src/lib/forms.test.ts",
  "apps/web/src/lib/records.test.ts",
  "packages/objects/src/dal/data-access.ts",
  "packages/objects/src/define-object.ts",
  "packages/objects/src/fields/base.ts",
  "packages/objects/src/fields/choice.ts",
  "packages/objects/src/fields/test-helpers.ts",
  "packages/objects/src/repository.ts",
];

const pkg = (
  name: string,
  directory: string,
  dependencies: readonly string[]
): WorkspacePackage => ({ name, directory, dependencies });

const sources = (dir: string) =>
  sourceFiles(dir).map((file) => ({
    file,
    source: readFileSync(file, "utf-8"),
  }));

describe("dependency direction", () => {
  it("allows a downward dependency and refuses one that points up or at a module", () => {
    const problems = dependencyProblems([
      pkg("@workspace/db", "packages/db", ["@workspace/actions"]),
      pkg("@workspace/auth", "packages/auth", [
        "@workspace/actions",
        "@workspace/db",
        "@workspace/objects",
      ]),
      pkg("@workspace/objects", "packages/objects", ["@workspace/comms"]),
      pkg("@workspace/comms", "modules/comms", []),
    ]);
    expect(problems).toStrictEqual([
      "@workspace/db depends on @workspace/actions, which is not below it. The order is server and apps/web, then workflows, config and auth, then actions, objects, db.",
      "@workspace/objects depends on @workspace/comms. Packages must not depend on modules.",
    ]);
  });

  it("matches the repo, including auth's dependencies", () => {
    const packages = readWorkspacePackages(root);
    const auth = packages.find((item) => item.name === "@workspace/auth");
    expect(auth?.dependencies.toSorted()).toStrictEqual([
      "@workspace/actions",
      "@workspace/db",
      "@workspace/objects",
      "@workspace/testing",
    ]);
    expect(dependencyProblems(packages)).toStrictEqual([]);
  });
});

describe("web imports", () => {
  it("allows type imports and refuses values, drizzle and pg", () => {
    const source = [
      'import type { ApiError } from "@workspace/server";',
      'import { createDb } from "@workspace/db";',
      'import { eq } from "drizzle-orm";',
      'import type { Client } from "pg";',
      'const loaded = await import("@workspace/objects");',
    ].join("\n");
    expect(
      webImportProblems(source).map((problem) => problem.message)
    ).toStrictEqual([
      "imports @workspace/db as a value. The web app may only import type from it.",
      "imports drizzle-orm. The web app does not talk to the database.",
      "imports pg. The web app does not talk to the database.",
      "imports @workspace/objects. The web app may only import type from the core, and never the database driver.",
    ]);
  });

  it("holds apps/web/src to that rule", () => {
    const problems = sources(path.join(root, "apps", "web", "src")).flatMap(
      ({ file, source }) =>
        webImportProblems(source).map(
          (problem) =>
            `${path.relative(root, file)}:${problem.line} ${problem.message}`
        )
    );
    expect(problems).toStrictEqual([]);
  });
});

describe("casts and comments", () => {
  it("reports a plan id, a TODO and a suppressed error", () => {
    const slash = "/";
    const sample = [
      `${slash}${slash} Shipped in P2.04.`,
      `${slash}${slash} TODO: later`,
      `${slash}${slash} @ts-expect-error no`,
      "const ok = 1;",
    ].join("\n");
    expect(
      commentProblems(sample).map((problem) => problem.message)
    ).toStrictEqual([
      "Plan ids belong in docs/plans, not in source comments.",
      "TODO, HACK and workaround comments are not allowed.",
      "Use a type that checks, not @ts-ignore or @ts-expect-error.",
    ]);
  });

  it("keeps double casts to the allowlist, and the source free of the comment bans", () => {
    const dirs = ["packages", "apps", "modules", "examples", "tools"].map(
      (dir) => path.join(root, dir)
    );
    const files = dirs.flatMap((dir) => sourceFiles(dir));
    const comments = files.flatMap((file) =>
      commentProblems(readFileSync(file, "utf-8")).map(
        (problem) =>
          `${path.relative(root, file)}:${problem.line} ${problem.message}`
      )
    );
    expect(castProblems(root, files, castAllowlist)).toStrictEqual([]);
    expect(comments).toStrictEqual([]);
  });
});
