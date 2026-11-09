// What the dispatcher reads and writes (P2.19): events no workflow has been
// offered yet, oldest first, and marking them done. Whether a workflow has
// already run for an event is the runs table's unique index, so two
// dispatchers can read the same event and still start each run once.
import { asc, inArray, isNull } from "drizzle-orm";

import type { Executor } from "./client.ts";
import { eventLog } from "./schema/core.ts";

/** Up to `limit` events not yet dispatched, oldest first. */
export const undispatchedEvents = (executor: Executor, limit: number) =>
  executor
    .select()
    .from(eventLog)
    .where(isNull(eventLog.dispatchedAt))
    .orderBy(asc(eventLog.createdAt))
    .limit(limit);

export type EventRow = Awaited<ReturnType<typeof undispatchedEvents>>[number];

/** Marks `ids` dispatched at `at`. */
export const markDispatched = async (
  executor: Executor,
  ids: readonly string[],
  at: Date
) => {
  if (ids.length > 0) {
    await executor
      .update(eventLog)
      .set({ dispatchedAt: at })
      .where(inArray(eventLog.id, [...ids]));
  }
};

/**
 * Whether `error`, or any error it wraps, is Postgres refusing a row for
 * the unique index `constraint`.
 */
export const isUniqueViolation = (error: unknown, constraint: string) => {
  let current: unknown = error;
  while (current instanceof Error) {
    const { code, constraint: name } = current as Error & {
      code?: string;
      constraint?: string;
    };
    if (code === "23505" && name === constraint) {
      return true;
    }
    current = current.cause;
  }
  return false;
};
