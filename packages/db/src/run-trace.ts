// Writing a workflow run's trace (P2.17, decision 0046): runs and their
// steps, inserted or brought up to date in one statement each, so the
// runner writes a run's steps once at its end rather than step by step.
import { sql } from "drizzle-orm";

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
