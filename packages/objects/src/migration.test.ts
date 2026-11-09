// The Done-when test for: objects generate a migration through
// drizzle-kit, and the migration builds tables that store and return records.

import { checkSchema, coreTables } from "@workspace/db";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  createCrmDatabase,
  createStaffActor,
} from "./test-fixtures/crm-database.ts";
import type { CrmDatabase } from "./test-fixtures/crm-database.ts";
import { contact, organisation } from "./test-fixtures/crm-schema.ts";

describe("a migration from defineObject", () => {
  let crm: CrmDatabase;

  beforeAll(async () => {
    crm = await createCrmDatabase();
  }, 60_000);

  afterAll(async () => {
    await crm?.close();
  });

  it("creates only the object tables, not the core ones again", () => {
    expect(crm.migration).toContain('CREATE TABLE "organisations"');
    expect(crm.migration).toContain('CREATE TABLE "contacts"');
    expect(crm.migration).not.toContain('CREATE TABLE "actors"');
  });

  it("has the housekeeping and field columns", () => {
    const { migration } = crm;
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
    const { migration } = crm;
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
    const result = await checkSchema(crm.db, [
      ...coreTables,
      organisation.table,
      contact.table,
    ]);
    expect(result.problems).toStrictEqual([]);
  });

  it("stores records and reads them back through fromRow", async () => {
    const { db } = crm;
    const actor = await createStaffActor(db);
    const by = { createdBy: actor.id, updatedBy: actor.id };

    const [org] = await db
      .insert(organisation.table)
      .values({
        ...by,
        ...organisation.toRow({ name: "Acme", owner: actor.id }),
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
      createdBy: actor.id,
    });
  });
});
