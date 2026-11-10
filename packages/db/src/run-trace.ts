// Writing a workflow run's trace (P2.17, decision 0046): runs and their
// steps, inserted or brought up to date in one statement each, so the
// runner writes a run's steps once at its end rather than step by step.
import { and, desc, eq, inArray, sql } from "drizzle-orm";

import type { Executor } from "./client.ts";
import { runSteps, runs } from "./schema/core.ts";

export type RunRow = typeof runs.$inferInsert & { id: string };
export type RunStepRow = typeof runSteps.$inferInsert & { id: string };

/** Inserts `rows`, or brings each existing one's outcome up to date. */
export const saveRuns = async (executor: Executor, rows: readonly RunRow[]) => {
  if (rows.length === 0) {
    return;
  }
  await executor
    .insert(runs)
    .values([...rows])
    .onConflictDoUpdate({
      target: runs.id,
      set: {
        status: sql`excluded.status`,
        output: sql`excluded.output`,
        error: sql`excluded.error`,
        finishedAt: sql`excluded.finished_at`,
      },
    });
};

/** Inserts `rows`, or brings each existing one's outcome up to date. */
export const saveRunSteps = async (
  executor: Executor,
  rows: readonly RunStepRow[]
) => {
  if (rows.length === 0) {
    return;
  }
  await executor
    .insert(runSteps)
    .values([...rows])
    .onConflictDoUpdate({
      target: runSteps.id,
      set: {
        output: sql`excluded.output`,
        error: sql`excluded.error`,
        branch: sql`excluded.branch`,
        finishedAt: sql`excluded.finished_at`,
      },
    });
};

/** The statuses a reused retry key replays rather than runs again. */
const replayedStatuses = [
  "succeeded",
  "running",
  "waiting",
  "needs_attention",
] as const;

/**
 * The run `actorId` made with `retryKey` that a second call with the key
 * replays (P2.18): one that succeeded, or one still going, waiting or
 * needing attention (P2.20), so a retry during a pause doesn't start the
 * work again. A failed run doesn't count: the key may try again.
 */
export const findRetriedRun = async (
  executor: Executor,
  actorId: string,
  retryKey: string
) => {
  const [row] = await executor
    .select()
    .from(runs)
    .where(
      and(
        eq(runs.actorId, actorId),
        eq(runs.retryKey, retryKey),
        inArray(runs.status, [...replayedStatuses]),
        eq(runs.dryRun, false)
      )
    )
    .orderBy(desc(runs.startedAt))
    .limit(1);
  return row ?? null;
};

/** The run `id`, locked until the transaction ends: one segment at a time. */
export const lockRun = async (executor: Executor, id: string) => {
  const [row] = await executor
    .select()
    .from(runs)
    .where(eq(runs.id, id))
    .for("update");
  return row ?? null;
};

/** The run `id`, if there is one. */
export const findRun = async (executor: Executor, id: string) => {
  const [row] = await executor.select().from(runs).where(eq(runs.id, id));
  return row ?? null;
};

/** Brings the run `id` up to date: its status, outcome or checkpoint. */
export const updateRun = async (
  executor: Executor,
  id: string,
  change: Partial<Omit<RunRow, "id">>
) => {
  await executor.update(runs).set(change).where(eq(runs.id, id));
};

/** Brings the run step `id` up to date: its output, error or end. */
export const updateRunStep = async (
  executor: Executor,
  id: string,
  change: Partial<Omit<RunStepRow, "id">>
) => {
  await executor.update(runSteps).set(change).where(eq(runSteps.id, id));
};
