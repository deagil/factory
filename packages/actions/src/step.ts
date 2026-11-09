// Runs one action as a workflow step (P2.15, decisions 0045 and 0046). An
// internal action runs in the segment's transaction under the service key:
// its repository has no role rules and its reads see everything. An
// external one runs outside any transaction and gets the step's retry key.
// Either way the step hands back its output or typed error and the events
// it emitted; the engine writes the trace and the event log, never the
// action (AGENTS.md rule 11).

import { createDraftStore, createIdentityStore } from "@workspace/db";
import type { Tx } from "@workspace/db";
import { createDataAccess, createRepository } from "@workspace/objects";
import { z } from "zod";

import { createActionContext } from "./context.ts";
import type { EmittedEvent } from "./context.ts";
import type {
  Actor,
  AnyActionDefinition,
  ApprovalService,
  Clock,
  ConfigService,
  ExternalContext,
  GitService,
} from "./define-action.ts";
import { declaredFailure, failures, isActionFailure } from "./errors.ts";
import type { ActionError, DeclaredError } from "./errors.ts";
import { everythingRole, grantedBy } from "./permissions.ts";

/** Where a step runs: its run, and which step of it. */
export interface StepPlace {
  /** The `runs` row. */
  runId: string;
  /** The step's id in its workflow, such as `update`: part of its retry key. */
  stepId: string;
  /** This attempt's `run_steps` row, which audit rows point at. */
  rowId: string;
}

export interface StepOptions {
  place: StepPlace;
  /** The workflow, which a run records as its actor (decision 0045). */
  actor: Actor;
  /** The person at the start of the chain; checks compare against them. */
  originUserId: string | null;
  /** The config the run is pinned to. */
  config: ConfigService;
  clock: Clock;
  git?: GitService;
  dryRun?: boolean;
}

export type StepResult =
  | { ok: true; output: unknown; events: EmittedEvent[] }
  | { ok: false; error: ActionError | DeclaredError };

/** The service key: everything, which a workflow's steps run with. */
const serviceKey = grantedBy([everythingRole]);

/** A step's retry key: its run and its id there, the same on every attempt. */
export const retryKeyOf = (place: StepPlace) =>
  `${place.runId}:${place.stepId}`;

/** Approvals come with `wait_for_approval` (P2.20), not to a step's action. */
const noApprovals = new Proxy({} as ApprovalService, {
  get: (_target, property) => {
    throw new Error(
      `A workflow step's action can't use ctx.approvals (asked for ${String(property)}); a wait_for_approval step does that.`
    );
  },
});

const finish = (
  action: AnyActionDefinition,
  returned: unknown,
  events: () => EmittedEvent[]
): StepResult => {
  if (isActionFailure(returned)) {
    return { ok: false, error: returned.error };
  }
  const output = action.output.safeParse(returned);
  if (!output.success) {
    throw new Error(
      `${action.name} returned output that doesn't fit its schema:\n${z.prettifyError(output.error)}`
    );
  }
  return { ok: true, output: output.data, events: events() };
};

/** A thrown typed failure is a result too; anything else is a bug. */
const caught = (thrown: unknown): StepResult => {
  if (isActionFailure(thrown)) {
    return { ok: false, error: thrown.error };
  }
  throw thrown;
};

/**
 * Runs an internal action in `tx`, the segment's transaction, under the
 * service key. A failure doesn't roll `tx` back: the engine does that.
 */
export const runInternalStep = async (
  tx: Tx,
  action: AnyActionDefinition,
  input: unknown,
  options: StepOptions
): Promise<StepResult> => {
  if (action.kind !== "internal") {
    throw new Error(`${action.name} is external: run it with runExternalStep`);
  }
  const parsed = action.input.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: failures.invalidInput(parsed.error).error };
  }
  const { place, actor, config, clock } = options;
  const { ctx, events } = createActionContext(action, {
    repo: createRepository({
      executor: tx,
      runId: place.runId,
      stepId: place.rowId,
      actorId: actor.id,
      now: clock.now,
      choices: config.choices,
    }),
    dal: createDataAccess({
      executor: tx,
      canRead: () => "all",
      choices: config.choices,
    }),
    granted: serviceKey,
    identity: createIdentityStore(tx),
    drafts: createDraftStore(tx),
    approvals: noApprovals,
    dryRun: options.dryRun ?? false,
    // The service key holds everything, so nothing is beyond it.
    grantsBeyond: () => null,
    config,
    git: options.git,
    clock,
    actor,
    originUserId: options.originUserId,
  });
  try {
    return finish(action, await action.handler(ctx, parsed.data), events);
  } catch (error) {
    return caught(error);
  }
};

/** Runs an external action, outside any transaction, with its retry key. */
export const runExternalStep = async (
  action: AnyActionDefinition,
  input: unknown,
  options: StepOptions
): Promise<StepResult> => {
  if (action.kind !== "external") {
    throw new Error(`${action.name} is internal: run it with runInternalStep`);
  }
  const parsed = action.input.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: failures.invalidInput(parsed.error).error };
  }
  const ctx: ExternalContext = Object.freeze({
    ...failures,
    fail: declaredFailure(action.errors),
    retryKey: retryKeyOf(options.place),
    config: options.config,
    clock: options.clock,
    actor: options.actor,
    originUserId: options.originUserId,
    dryRun: options.dryRun ?? false,
  });
  try {
    return finish(action, await action.handler(ctx, parsed.data), () => []);
  } catch (error) {
    return caught(error);
  }
};
