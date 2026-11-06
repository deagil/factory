// The Done-when test for P1.02: objects generate a migration through
// drizzle-kit, and the migration builds tables that store and return records.

import { spawnSync } from "node:child_process";
import {
  cpSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import {
  actors,
  checkSchema,
  closeDb,
  coreTables,
  createDb,
  migrationsFolder,
  users,
} from "@workspace/db";
import type { Db } from "@workspace/db";
import { createTestDatabase } from "@workspace/testing";
import type { TestDatabase } from "@workspace/testing";
import { eq } from "drizzle-orm";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { contact, organisation } from "./test-fixtures/crm-schema.ts";

const packageDir = path.resolve(import.meta.dirname, "..");
const coreSchema = path.resolve(packageDir, "../db/src/schema/core.ts");
const fixtureSchema = path.resolve(
  import.meta.dirname,
  "test-fixtures/crm-schema.ts"
);

/**
 * Runs drizzle-kit generate for the core tables and the fixture objects,
 * against a copy of the core migrations, and returns the new migration.
 * drizzle-kit mangles absolute paths, so every path is relative to this
 * package.
 */
const generate = (out: string) => {
  cpSync(migrationsFolder, out, { recursive: true });
  const relative = (to: string) => path.relative(packageDir, to);
  const config = path.join(out, "drizzle.config.mjs");
  writeFileSync(
    config,
    `export default ${JSON.stringify({
      dialect: "postgresql",
      schema: [relative(coreSchema), relative(fixtureSchema)],
      out: relative(out),
    })};\n`
  );
  const result = spawnSync(
    "pnpm",
    [
      "exec",
      "drizzle-kit",
      "generate",
      "--config",
      relative(config),
      "--name",
      "crm",
    ],
    { cwd: packageDir, encoding: "utf-8", stdio: ["ignore", "pipe", "pipe"] }
  );
  const sqlFile = readdirSync(out).find((name) => name.endsWith("_crm.sql"));
  if (!sqlFile) {
    throw new Error(
      `drizzle-kit generated no migration:\n${result.stdout}${result.stderr}`
    );
  }
  return readFileSync(path.join(out, sqlFile), "utf-8");
};

describe("a migration from defineObject", () => {
  let out: string;
  let migration: string;
  let database: TestDatabase;
  let db: Db;

  beforeAll(async () => {
    out = mkdtempSync(path.join(tmpdir(), "objects-migration-"));
    migration = generate(out);
    database = await createTestDatabase();
    db = createDb(database.url);
    await migrate(db, { migrationsFolder: out });
  }, 60_000);

  afterAll(async () => {
    if (db) {
      await closeDb(db);
    }
    await database?.drop();
    rmSync(out, { recursive: true, force: true });
  });

  it("creates only the object tables, not the core ones again", () => {
    expect(migration).toContain('CREATE TABLE "organisations"');
    expect(migration).toContain('CREATE TABLE "contacts"');
    expect(migration).not.toContain('CREATE TABLE "actors"');
  });

  it("has the housekeeping and field columns", () => {
    expect(migration).toContain(
      '"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL'
    );
    expect(migration).toContain(
      "\"custom_fields\" jsonb DEFAULT '{}'::jsonb NOT NULL"
    );
    expect(migration).toContain('"organisation_id" uuid NOT NULL');
    expect(migration).toContain('"lifetime_value" bigint');
    expect(migration).toContain('"lifetime_value_currency" text');
  });

  it("adds foreign keys and indexes", () => {
    expect(migration).toMatch(
      /FOREIGN KEY \("organisation_id"\) REFERENCES "public"\."organisations"\("id"\)/u
    );
    expect(migration).toMatch(
      /FOREIGN KEY \("owner_id"\) REFERENCES "public"\."actors"\("id"\)/u
    );
    expect(migration).toContain('CREATE INDEX "contacts_organisation_id_idx"');
    expect(migration).toContain(
      'CREATE INDEX "organisations_custom_fields_idx" ON "organisations" USING gin'
    );
    expect(migration).toContain('CREATE INDEX "contacts_last_name_idx"');
  });

  it("passes the schema check", async () => {
    const result = await checkSchema(db, [
      ...coreTables,
      organisation.table,
      contact.table,
    ]);
    expect(result.problems).toStrictEqual([]);
  });

  it("stores records and reads them back through fromRow", async () => {
    const [user] = await db
      .insert(users)
      .values({ name: "Sarah", email: "sarah@example.com" })
      .returning();
    const [actor] = await db
      .insert(actors)
      .values({ kind: "staff", name: "Sarah", userId: user?.id })
      .returning();
    const actorId = actor?.id ?? "";
    const by = { createdBy: actorId, updatedBy: actorId };

    const [org] = await db
      .insert(organisation.table)
      .values({
        ...by,
        ...organisation.toRow({ name: "Acme", owner: actorId }),
      } as never)
      .returning();
    const values = contact.schemas.create.parse({
      firstName: "Ada",
      organisation: org?.id,
      active: true,
      birthday: "1990-12-10",
      lifetimeValue: { amount: 123_450, currency: "GBP" },
    });
    await db
      .insert(contact.table)
      .values({ ...by, ...contact.toRow(values) } as never);

    const [row] = await db
      .select()
      .from(contact.table)
      .where(eq(contact.table.firstName, "Ada"));
    const record = contact.schemas.record.parse(contact.fromRow(row ?? {}));
    expect(record).toMatchObject({
      firstName: "Ada",
      lastName: null,
      organisation: org?.id,
      active: true,
      birthday: "1990-12-10",
      lifetimeValue: { amount: 123_450, currency: "GBP" },
      archivedAt: null,
      version: 1,
      createdBy: actorId,
    });
  });
});
