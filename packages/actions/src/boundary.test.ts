import path from "node:path";

import { describe, expect, it } from "vitest";

import {
  checkHandlerBoundary,
  checkSource,
  formatBoundaryProblems,
} from "./boundary.ts";

const handlerFile = (...lines: string[]) =>
  [
    'import { defineAction } from "@workspace/actions";',
    ...lines,
    'export const close = defineAction({ name: "deal.close" });',
  ].join("\n");

const messages = (source: string) =>
  checkSource(source).map(({ line, message }) => `${line}: ${message}`);

describe("the handler boundary", () => {
  it("allows a handler file that uses only ctx", () => {
    expect(
      checkSource(
        handlerFile(
          'import { z } from "zod";',
          'import { deal } from "../objects/deal.ts";',
          "const at = new Date(input.at);"
        )
      )
    ).toStrictEqual([]);
  });

  it("refuses service packages, and their subpaths", () => {
    expect(
      messages(
        handlerFile(
          'import { createDb } from "@workspace/db";',
          'import type { Tx } from "@workspace/db";',
          'import { eq } from "drizzle-orm";',
          'import { pgTable } from "drizzle-orm/pg-core";',
          'const pg = await import("pg");'
        )
      ).filter((message) => message.includes("imports"))
    ).toStrictEqual([
      "2: imports @workspace/db. Handlers reach the database, config and other services through ctx.",
      "3: imports @workspace/db. Handlers reach the database, config and other services through ctx.",
      "4: imports drizzle-orm. Handlers reach the database, config and other services through ctx.",
      "5: imports drizzle-orm/pg-core. Handlers reach the database, config and other services through ctx.",
      "6: imports pg. Handlers reach the database, config and other services through ctx.",
    ]);
  });

  it("refuses building a repository or data access layer", () => {
    expect(
      messages(
        handlerFile(
          'import { createRepository } from "@workspace/objects";',
          "const repo = createRepository({ executor });"
        )
      )
    ).toStrictEqual([
      "2: uses createRepository. Use ctx.repo and ctx.dal, which are bound to the action's transaction.",
      "3: uses createRepository. Use ctx.repo and ctx.dal, which are bound to the action's transaction.",
    ]);
  });

  it("refuses the system clock", () => {
    expect(
      messages(handlerFile("const a = Date.now();", "const b = new Date();"))
    ).toStrictEqual([
      "2: reads the system clock. Use ctx.clock.now().",
      "3: reads the system clock. Use ctx.clock.now().",
    ]);
  });

  it("ignores comments, and files that define no handlers", () => {
    expect(
      checkSource(
        handlerFile(
          '// import { createDb } from "@workspace/db";',
          "/* Date.now() */"
        )
      )
    ).toStrictEqual([]);
    expect(
      checkSource('import { createDb } from "@workspace/db";\ncreateDb(url);')
    ).toStrictEqual([]);
  });
});

describe("the core's own handlers", () => {
  it("reach services only through ctx", () => {
    const root = path.resolve(import.meta.dirname, "../../..");
    const found = checkHandlerBoundary(
      ["packages", "modules", "examples", "templates"].map((dir) =>
        path.join(root, dir)
      )
    );
    expect(formatBoundaryProblems(found, root)).toBe("");
  });
});
