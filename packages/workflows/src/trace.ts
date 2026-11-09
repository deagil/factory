// The trace of a run (P2.17, decision 0046): every run, step and event the
// engine writes. A run and each action or run step are inserted when they
// start, since what they change points at them; the rest is kept here and
// written in one go when the run ends, which keeps a run's round trips
// down. After a rollback the runs and steps are written again, so a failed
// run keeps its trace; its events never happened.
import { saveRunSteps, saveRuns } from "@workspace/db";
import type { Db, Executor, RunRow, RunStepRow } from "@workspace/db";
import { eventLog } from "@workspace/db/schema";

export type { RunRow, RunStepRow } from "@workspace/db";
export type EventRow = typeof eventLog.$inferInsert;

export class Trace {
  readonly runs: RunRow[] = [];
  readonly steps: RunStepRow[] = [];
  readonly events: EventRow[] = [];

  /** A run, inserted now: its steps point at it. */
  async startRun(executor: Executor, row: RunRow) {
    this.runs.push(row);
    await saveRuns(executor, [row]);
  }

  endRun(id: string, change: Partial<RunRow>) {
    Object.assign(this.runs.find((row) => row.id === id) ?? {}, change);
  }

  /** A step that changes data, inserted now: history points at it. */
  async startStep(executor: Executor, row: RunStepRow) {
    this.steps.push(row);
    await saveRunSteps(executor, [row]);
  }

  /** A step nothing points at until the run ends, written then. */
  addStep(row: RunStepRow) {
    this.steps.push(row);
  }

  endStep(id: string, change: Partial<RunStepRow>) {
    Object.assign(this.steps.find((row) => row.id === id) ?? {}, change);
  }

  addEvents(rows: readonly EventRow[]) {
    this.events.push(...rows);
  }

  /** Writes the steps, then the events that point at them, then the runs. */
  async finish(executor: Executor) {
    await saveRunSteps(executor, this.steps);
    if (this.events.length > 0) {
      await executor.insert(eventLog).values(this.events);
    }
    await saveRuns(executor, this.runs);
  }

  /** After a rollback: every run still going failed with `error`. */
  async rewrite(db: Db, error: unknown, now: Date) {
    for (const run of this.runs) {
      if (run.status === "running") {
        Object.assign(run, { status: "failed", error, finishedAt: now });
      }
    }
    for (const step of this.steps) {
      step.finishedAt ??= now;
    }
    await db.transaction(async (tx) => {
      await saveRuns(tx, this.runs);
      await saveRunSteps(tx, this.steps);
    });
  }
}
