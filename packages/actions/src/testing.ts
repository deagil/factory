// Runs one action against a test database, as a workflow step would
// (P2.15): for unit tests of actions. An internal action runs in a
// transaction of its own under a run with one step, so its audit rows have
// a run to point at; a failure rolls it back, as a segment's would.

import type { Db } from "@workspace/db";
import { runSteps, runs } from "@workspace/db/schema";
import { eq } from "drizzle-orm";

import type {
  Actor,
  AnyActionDefinition,
  Clock,
  ConfigService,
} from "./define-action.ts";
import { runExternalStep, runInternalStep } from "./step.ts";
import type { StepResult } from "./step.ts";

export interface TestActionOptions {
  /** Who the run records as its actor: the workflow, in real runs. */
  actor: Pick<Actor, "id" | "kind" | "name"> & { userId?: string | null };
  /** The person who called; the ownership check compares against them. */
  originUserId?: string | null;
  config?: ConfigService;
  clock?: Clock;
  dryRun?: boolean;
}

export type TestActionResult = StepResult & { runId: string };

/** Carries a failed step out of its transaction, rolling it back. */
class StepFailedError extends Error {
  readonly result: StepResult;
  constructor(result: StepResult) {
    super("the step failed");
    this.name = "StepFailedError";
    this.result = result;
  }
}

/** Runs `action` with `input`; a failure leaves the database as it was. */
export const testAction = async (
  db: Db,
  action: AnyActionDefinition,
  input: unknown,
  options: TestActionOptions
): Promise<TestActionResult> => {
  const actor: Actor = { userId: null, ...options.actor };
  const clock = options.clock ?? { now: () => new Date() };
  const config = options.config ?? { sha: null, roles: [] };
  const originUserId = options.originUserId ?? null;
  const [run] = await db
    .insert(runs)
    .values({
      endpoint: action.name,
      actorId: actor.id,
      originUserId,
      input: input ?? null,
      status: "running",
    })
    .returning({ id: runs.id });
  const runId = run?.id ?? "";
  const step = { runId, stepId: action.name };
  const close = async (result: StepResult): Promise<TestActionResult> => {
    await db
      .update(runs)
      .set({
        status: result.ok ? "succeeded" : "failed",
        finishedAt: clock.now(),
      })
      .where(eq(runs.id, runId));
    return { ...result, runId };
  };
  const common = { actor, originUserId, config, clock, dryRun: options.dryRun };
  if (action.kind === "external") {
    const result = await runExternalStep(action, input, {
      ...common,
      place: { ...step, rowId: "" },
    });
    return close(result);
  }
  try {
    const result = await db.transaction(async (tx) => {
      const [row] = await tx
        .insert(runSteps)
        .values({ ...step, kind: "action", name: action.name })
        .returning({ id: runSteps.id });
      const done = await runInternalStep(tx, action, input, {
        ...common,
        place: { ...step, rowId: row?.id ?? "" },
      });
      if (!done.ok) {
        throw new StepFailedError(done);
      }
      return done;
    });
    return await close(result);
  } catch (error) {
    if (error instanceof StepFailedError) {
      return close(error.result);
    }
    throw error;
  }
};
