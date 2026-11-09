import { createTestDatabase } from "@workspace/testing";
import type { TestDatabase } from "@workspace/testing";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { closeDb, createDb } from "../client.ts";
import type { Db } from "../client.ts";
import { actionLog, actors, users } from "./core.ts";

describe("core tables", () => {
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
        name: "contact_create",
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
      name: "contact_create",
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
