// Identity lookups and writes. Sign-in uses the lookups before any actor
// exists to run an action as (decision 0023); the identity store is only
// used through `ctx.identity`, inside actions (decision 0025).

import { createHash, randomBytes } from "node:crypto";

import { and, eq, isNull, sql } from "drizzle-orm";

import type { Executor } from "./client.ts";
import { actorRoles, actors, apiKeys, users } from "./schema/core.ts";

/** Whether the user exists and may sign in. */
export const isActiveUser = async (db: Executor, userId: string) => {
  const [user] = await db
    .select({ status: users.status })
    .from(users)
    .where(eq(users.id, userId));
  return user?.status === "active";
};

/** The user's staff actor, created the first time it's asked for. */
export const staffActorFor = async (db: Executor, userId: string) => {
  const find = () =>
    db
      .select({ id: actors.id, status: actors.status })
      .from(actors)
      .where(and(eq(actors.userId, userId), eq(actors.kind, "staff")));
  const [found] = await find();
  if (found) {
    return found;
  }
  const [user] = await db
    .select({ name: users.name })
    .from(users)
    .where(eq(users.id, userId));
  if (!user) {
    throw new Error(`There is no user ${userId}`);
  }
  // Two first sign-ins at once both get here; the unique index keeps one.
  await db
    .insert(actors)
    .values({ kind: "staff", name: user.name, userId })
    .onConflictDoNothing();
  const [created] = await find();
  if (!created) {
    throw new Error(`No staff actor for user ${userId}`);
  }
  return created;
};

/**
 * A person and their staff actor with `roles`, found by email or created.
 * Only seed data and first-time setup use it: there is no actor yet to run
 * an action as (decision 0031). Returns the staff actor.
 */
export const bootstrapStaff = async (
  db: Executor,
  person: { name: string; email: string; roles: readonly string[] }
) => {
  await db
    .insert(users)
    .values({ name: person.name, email: person.email })
    .onConflictDoNothing();
  const [user] = await db
    .select({ id: users.id })
    .from(users)
    .where(sql`lower(${users.email}) = lower(${person.email})`);
  if (!user) {
    throw new Error(`Couldn't find or create ${person.email}`);
  }
  const actor = await staffActorFor(db, user.id);
  if (person.roles.length > 0) {
    await db
      .insert(actorRoles)
      .values(person.roles.map((roleKey) => ({ actorId: actor.id, roleKey })))
      .onConflictDoNothing();
  }
  return { id: actor.id, userId: user.id };
};

/** API keys look like `fx_<43 characters>`; only their hash is stored. */
export const apiKeyPrefix = "fx_";

/** The stored form of an API key. */
export const hashApiKey = (key: string) =>
  createHash("sha256").update(key).digest("hex");

/**
 * The actor an API key belongs to, if the key is live and the actor active.
 * Records when the key was last used.
 */
export const actorForApiKey = async (db: Executor, key: string, now: Date) => {
  const [found] = await db
    .select({
      keyId: apiKeys.id,
      revokedAt: apiKeys.revokedAt,
      actorId: actors.id,
      status: actors.status,
      userId: actors.userId,
    })
    .from(apiKeys)
    .innerJoin(actors, eq(actors.id, apiKeys.actorId))
    .where(eq(apiKeys.keyHash, hashApiKey(key)));
  if (!found || found.revokedAt !== null || found.status !== "active") {
    return;
  }
  await db
    .update(apiKeys)
    .set({ lastUsedAt: now })
    .where(eq(apiKeys.id, found.keyId));
  return { actorId: found.actorId, userId: found.userId };
};

/**
 * Writes to the identity tables, for the core's own actions (`apiKey.create`
 * and friends) through `ctx.identity`. Bound to the run's transaction.
 */
export const createIdentityStore = (executor: Executor) => ({
  getActor: async (id: string) => {
    const [actor] = await executor
      .select()
      .from(actors)
      .where(eq(actors.id, id));
    return actor;
  },
  createActor: async (values: {
    kind: "agent" | "integration";
    name: string;
    userId?: string | null;
  }) => {
    const [actor] = await executor.insert(actors).values(values).returning();
    if (!actor) {
      throw new Error("insert returned no actor");
    }
    return actor;
  },
  grantRoles: async (actorId: string, roleKeys: readonly string[]) => {
    if (roleKeys.length > 0) {
      await executor
        .insert(actorRoles)
        .values(roleKeys.map((roleKey) => ({ actorId, roleKey })))
        .onConflictDoNothing();
    }
  },
  /** A new key for `actorId`. The plain key is only ever returned here. */
  createApiKey: async (values: { actorId: string; label: string }) => {
    const key = `${apiKeyPrefix}${randomBytes(32).toString("base64url")}`;
    const [row] = await executor
      .insert(apiKeys)
      .values({ ...values, keyHash: hashApiKey(key) })
      .returning({ id: apiKeys.id });
    return { id: row?.id ?? "", key };
  },
  getApiKey: async (id: string) => {
    const [key] = await executor
      .select({
        id: apiKeys.id,
        actorId: apiKeys.actorId,
        revokedAt: apiKeys.revokedAt,
      })
      .from(apiKeys)
      .where(eq(apiKeys.id, id));
    return key;
  },
  revokeApiKey: async (id: string, at: Date) => {
    await executor
      .update(apiKeys)
      .set({ revokedAt: at })
      .where(and(eq(apiKeys.id, id), isNull(apiKeys.revokedAt)));
  },
});

export type IdentityStore = ReturnType<typeof createIdentityStore>;
