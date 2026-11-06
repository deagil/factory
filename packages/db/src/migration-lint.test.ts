import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { migrationsFolder } from "./migrate.ts";
import { lintMigration, splitStatements } from "./migration-lint.ts";

const rulesFor = (sql: string) =>
  lintMigration(sql).map((finding) => finding.rule);

describe(lintMigration, () => {
  it("accepts the core tables migration", () => {
    const sql = readFileSync(
      path.join(migrationsFolder, "0000_core_tables.sql"),
      "utf-8"
    );
    expect(lintMigration(sql)).toStrictEqual([]);
  });

  it.each([
    ['ALTER TABLE "deals" DROP COLUMN "stage";', "drop"],
    ['DROP TABLE "deals" CASCADE;', "drop"],
    ['DROP INDEX "deals_stage_idx";', "drop"],
    ['ALTER TABLE "deals" DROP CONSTRAINT "deals_org_fk";', "drop"],
    ['ALTER TABLE "deals" RENAME COLUMN "stage" TO "status";', "rename"],
    ['ALTER TABLE "deals" RENAME TO "opportunities";', "rename"],
    [
      'ALTER TABLE "deals" ALTER COLUMN "value" SET DATA TYPE bigint;',
      "alter-type",
    ],
    ['ALTER TABLE "deals" ALTER COLUMN "value" TYPE bigint;', "alter-type"],
    ['ALTER TABLE "deals" ALTER COLUMN "title" SET NOT NULL;', "set-not-null"],
    [
      'ALTER TABLE "deals" ADD COLUMN "title" text NOT NULL;',
      "add-required-column",
    ],
    ['TRUNCATE "deals";', "truncate"],
  ])("refuses %s", (sql, rule) => {
    expect(rulesFor(sql)).toContain(rule);
  });

  it.each([
    'ALTER TABLE "deals" ADD COLUMN "note" text;',
    'ALTER TABLE "deals" ADD COLUMN "status" text DEFAULT \'open\' NOT NULL;',
    'ALTER TABLE "deals" ALTER COLUMN "title" DROP NOT NULL;',
    'CREATE INDEX "deals_stage_idx" ON "deals" USING btree ("stage");',
    // Keywords inside names, strings and comments don't count.
    'CREATE TABLE "drop_rename" ("id" uuid PRIMARY KEY NOT NULL);',
    'ALTER TABLE "deals" ADD COLUMN "kind" text DEFAULT \'drop\';',
    '-- rename later\nCREATE TABLE "x" ("id" uuid);',
  ])("accepts %s", (sql) => {
    expect(lintMigration(sql)).toStrictEqual([]);
  });

  it("allows destructive statements in a marked contract step", () => {
    const sql =
      '-- contract-step: stage replaced by status in #42\nALTER TABLE "deals" DROP COLUMN "stage";';
    expect(lintMigration(sql)).toStrictEqual([]);
  });

  it("needs a reason in the contract marker", () => {
    const sql = '-- contract-step:\nALTER TABLE "deals" DROP COLUMN "stage";';
    expect(rulesFor(sql)).toStrictEqual(["drop"]);
  });

  it("numbers findings by statement", () => {
    const sql =
      'ALTER TABLE "a" ADD COLUMN "b" text;--> statement-breakpoint\nALTER TABLE "a" DROP COLUMN "c";';
    expect(
      lintMigration(sql).map((finding) => finding.statement)
    ).toStrictEqual([2]);
  });
});

describe(splitStatements, () => {
  it("splits on Drizzle breakpoints and semicolons", () => {
    expect(
      splitStatements(
        'CREATE TABLE "a" ();\n--> statement-breakpoint\nCREATE TABLE "b" ();'
      )
    ).toHaveLength(2);
  });
});
