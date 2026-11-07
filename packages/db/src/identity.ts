// Identity lookups the sign-in code needs before any actor exists to run an
// action as (decision 0023). Everything else writes through actions.

import { and, eq } from "drizzle-orm";

import type { Executor } from "./client.ts";
import { actors, users } from "./schema/core.ts";

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
