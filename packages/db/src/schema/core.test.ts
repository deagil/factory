import { randomUUID } from "node:crypto";

import { eq } from "drizzle-orm";
import { Client } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { closeDb, createDb } from "../client.ts";
import type { Db } from "../client.ts";
import { requireEnv } from "../env.ts";
import { runMigrations } from "../migrate.ts";
import { actionLog, actors, users } from "./core.ts";

// A throwaway database for this file. P0.06 replaces this with
// createTestDatabase() from @workspace/testing.
const adminUrl = requireEnv("DATABASE_ADMIN_URL");
const databaseName = `factory_test_${randomUUID().replaceAll("-", "")}`;
const databaseUrl = Object.assign(new URL(adminUrl), {
  pathname: `/${databaseName}`,
}).toString();

const admin = async (statement: string) => {
  const client = new Client({ connectionString: adminUrl });
  await client.connect();
  try {
    await client.query(statement);
  } finally {
    await client.end();
  }
};

describe("core tables", () => {
  let db: Db;

  beforeAll(async () => {
    await admin(`create database "${databaseName}"`);
    await runMigrations(databaseUrl);
    db = createDb(databaseUrl);
  });

  afterAll(async () => {
    await closeDb(db);
    await admin(`drop database "${databaseName}" with (force)`);
  });

  it("inserts and reads an action_log row", async () => {
    const [user] = await db
      .insert(users)
      .values({ name: "Sarah", email: "sarah@example.com" })
      .returning();
    const [actor] = await db
      .insert(actors)
      .values({ kind: "staff", name: "Sarah", userId: user?.id })
      .returning();
    if (!(user && actor)) {
      throw new Error("insert returned no rows");
    }

    const [inserted] = await db
      .insert(actionLog)
      .values({
        name: "contact.create",
        actorId: actor.id,
        originUserId: user.id,
        input: { firstName: "Ada" },
        result: { id: "c-1" },
        status: "succeeded",
      })
      .returning();

    const rows = await db
      .select()
      .from(actionLog)
      .where(eq(actionLog.id, inserted?.id ?? ""));

    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      name: "contact.create",
      actorId: actor.id,
      originUserId: user.id,
      input: { firstName: "Ada" },
      status: "succeeded",
      dryRun: false,
      configSha: null,
    });
    // uuidv7: the version nibble is 7.
    expect(rows[0]?.id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-7/u);
  });

  it("refuses a staff actor without a user", async () => {
    await expect(
      db.insert(actors).values({ kind: "staff", name: "Nobody" })
    ).rejects.toMatchObject({ cause: { constraint: "actors_user_required" } });
  });

  it("treats emails as case-insensitive", async () => {
    await db.insert(users).values({ name: "Ada", email: "ada@example.com" });
    await expect(
      db.insert(users).values({ name: "Ada 2", email: "ADA@example.com" })
    ).rejects.toMatchObject({ cause: { constraint: "users_email_unique" } });
  });
});
