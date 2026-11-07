import { createTestDatabase } from "@workspace/testing";
import type { TestDatabase } from "@workspace/testing";
import { sql } from "drizzle-orm";
import {
  boolean,
  integer,
  pgTable,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";
import type { PgColumnBuilderBase } from "drizzle-orm/pg-core";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { closeDb, createDb } from "./client.ts";
import type { Db } from "./client.ts";
import {
  assertSchema,
  checkSchema,
  coreTables,
  normaliseType,
  SchemaCheckError,
} from "./schema-check.ts";
import { users } from "./schema/core.ts";

const others = coreTables.filter((table) => table !== users);

/** `users` as the code might define it, to compare with the real table. */
const usersWith = (columns: Record<string, PgColumnBuilderBase>) =>
  pgTable("users", columns);

const usersColumns = () => ({
  id: uuid("id").primaryKey(),
  name: text("name").notNull(),
  email: text("email").notNull(),
  status: text("status").notNull(),
  emailVerified: boolean("email_verified").notNull(),
  image: text("image"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull(),
});

describe("the schema check", () => {
  let database: TestDatabase;
  let db: Db;

  beforeAll(async () => {
    database = await createTestDatabase();
    db = createDb(database.url);
  });

  afterAll(async () => {
    await closeDb(db);
    await database.drop();
  });

  it("passes for the core tables after the migrations", async () => {
    await expect(checkSchema(db, coreTables)).resolves.toStrictEqual({
      ok: true,
      problems: [],
      unusedColumns: [],
    });
  });

  it("fails on a missing column, saying how to fix it", async () => {
    const result = await checkSchema(db, [
      usersWith({ ...usersColumns(), nickname: text("nickname") }),
      ...others,
    ]);
    expect(result.ok).toBeFalsy();
    expect(result.problems).toStrictEqual([
      {
        kind: "missing_column",
        table: "users",
        column: "nickname",
        message: expect.stringContaining("Run `pnpm db:migrate`"),
      },
    ]);
  });

  it("fails on a missing table", async () => {
    const widgets = pgTable("widgets", { id: uuid("id").primaryKey() });
    const result = await checkSchema(db, [...coreTables, widgets]);
    expect(result.problems.map((p) => [p.kind, p.table])).toStrictEqual([
      ["missing_table", "widgets"],
    ]);
  });

  it("fails on a table that isn't from defineObject or the core", async () => {
    await db.execute(sql`create table stray_notes (id integer)`);
    try {
      const result = await checkSchema(db, coreTables);
      expect(result.problems).toStrictEqual([
        {
          kind: "stray_table",
          table: "stray_notes",
          message: expect.stringMatching(
            /"stray_notes" isn't defined in the code\. .*Define it with defineObject, or drop it in a contract-step migration/u
          ),
        },
      ]);
    } finally {
      await db.execute(sql`drop table stray_notes`);
    }
  });

  it("fails on a wrong type or nullability", async () => {
    const result = await checkSchema(db, [
      usersWith({
        ...usersColumns(),
        email: integer("email").notNull(),
        name: text("name"),
      }),
      ...others,
    ]);
    expect(result.problems.map((p) => p.message)).toStrictEqual([
      expect.stringMatching(
        /^The column users\.name should be nullable, and the database says otherwise\./u
      ),
      expect.stringMatching(
        /^The column users\.email is text in the database, but the code says integer\./u
      ),
    ]);
  });

  it("allows columns the code no longer uses, and lists them", async () => {
    const { status: _status, ...withoutStatus } = usersColumns();
    const result = await checkSchema(db, [usersWith(withoutStatus), ...others]);
    expect(result.ok).toBeTruthy();
    expect(result.unusedColumns).toStrictEqual([
      { table: "users", column: "status" },
    ]);
  });

  it("throws every problem at once from assertSchema", async () => {
    const widgets = pgTable("widgets", { id: uuid("id").primaryKey() });
    const gadgets = pgTable("gadgets", { id: uuid("id").primaryKey() });
    const error = await assertSchema(db, [
      ...coreTables,
      widgets,
      gadgets,
    ]).catch((error_: unknown) => error_);
    expect(error).toBeInstanceOf(SchemaCheckError);
    expect((error as SchemaCheckError).message).toMatch(
      /^The database doesn't match the code \(2 problems\):\n- The table "widgets" is missing\..*\n- The table "gadgets" is missing\./u
    );
  });
});

describe(normaliseType, () => {
  it("matches Drizzle's type names to Postgres's", () => {
    expect(
      [
        "varchar(20)",
        "timestamp (3) with time zone",
        "timestamp",
        "numeric(10, 2)",
        "decimal",
        "int4",
        "serial",
        "text[]",
      ].map(normaliseType)
    ).toStrictEqual([
      "character varying(20)",
      "timestamp(3) with time zone",
      "timestamp without time zone",
      "numeric(10,2)",
      "numeric",
      "integer",
      "integer",
      "text[]",
    ]);
  });
});
