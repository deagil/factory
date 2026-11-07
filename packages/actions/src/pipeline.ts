// The action pipeline: every action, whoever calls it, runs identify,
// validate, authorise, approve, run, record and commit in one transaction.
// Queries run identify, validate, authorise and run. See
// docs/SYSTEM_DESIGN.md section 4.2 and decision 0020.

import { actionLog, actors, eventLog, withTransaction } from "@workspace/db";
import type { Db, Tx } from "@workspace/db";
import { createDataAccess, createRepository } from "@workspace/objects";
import type { AnyObjectDefinition, ReadAccess } from "@workspace/objects";
import { eq } from "drizzle-orm";
import { z } from "zod";

import { createActionContext, createQueryContext } from "./context.ts";
import type { EmittedEvent } from "./context.ts";
import type {
  Actor,
  AnyActionDefinition,
  AnyDefinition,
  AnyQueryDefinition,
  Clock,
  ConfigService,
} from "./define-action.ts";
import { failures, isActionFailure } from "./errors.ts";
import type { ActionError, ActionFailure } from "./errors.ts";

/** Who is calling: an actor, and the person at the start of the chain. */
export interface Caller {
  actorId: string;
  /**
   * The origin user. Defaults to the actor's own user (staff and agents);
   * workflows pass the one from the event that started them.
   */
  originUserId?: string | null;
}

/** What an unexpected error looks like to callers. Details stay in the log. */
export interface InternalError {
  code: "internal";
  message: string;
}

export type RunError = ActionError | InternalError;

export type ActionResult =
  | {
      ok: true;
      output: unknown;
      /** The action_log row. */
      actionId: string;
      events: EmittedEvent[];
    }
  /** `actionId` is null when the caller couldn't be identified. */
  | { ok: false; error: RunError; actionId: string | null };

export type QueryResult =
  | { ok: true; output: unknown }
  | { ok: false; error: RunError };

/**
 * Who may do what. P1.11 backs these with roles; until then everything is
 * allowed. `authorise` returns a failure (`failures.forbidden`) to refuse, or null.
 */
export interface Permissions {
  authorise: (
    actor: Actor,
    definition: AnyDefinition
  ) => ActionFailure | null | Promise<ActionFailure | null>;
  canRead: (actor: Actor, object: AnyObjectDefinition) => ReadAccess;
}

/**
 * Approval rules. Phase 2 plugs rules in; until then none match. Returns the
 * key of the rule that matched, or null.
 */
export type ApprovalRules = (
  action: AnyActionDefinition,
  input: unknown,
  actor: Actor
) => string | null | Promise<string | null>;

export interface PipelineOptions {
  db: Db;
  config: ConfigService;
  clock: Clock;
  permissions?: Permissions;
  approvals?: ApprovalRules;
}

export const allowAll: Permissions = {
  authorise: () => null,
  canRead: () => "all",
};

const noRules: ApprovalRules = () => null;

/** Carries a typed failure out of the transaction, rolling it back. */
class RollbackError extends Error {
  readonly failure: ActionFailure;
  constructor(failure: ActionFailure) {
    super(failure.error.message);
    this.name = "RollbackError";
    this.failure = failure;
  }
}

const internal = (message: string): InternalError => ({
  code: "internal",
  message,
});

/** The error to record and return for whatever a run threw. */
const errorFrom = (thrown: unknown): { error: RunError; logged: RunError } => {
  if (thrown instanceof RollbackError) {
    return { error: thrown.failure.error, logged: thrown.failure.error };
  }
  if (isActionFailure(thrown)) {
    return { error: thrown.error, logged: thrown.error };
  }
  const message = thrown instanceof Error ? thrown.message : String(thrown);
  return {
    error: internal(
      "The action failed unexpectedly. Its action_log row has the details."
    ),
    logged: internal(message),
  };
};

export const createPipeline = ({
  db,
  config,
  clock,
  permissions = allowAll,
  approvals = noRules,
}: PipelineOptions) => {
  /** 1. Identify: the actor, if it exists and is active. */
  const identify = async (caller: Caller) => {
    const [row] = await db
      .select()
      .from(actors)
      .where(eq(actors.id, caller.actorId));
    if (!row || row.status !== "active") {
      return;
    }
    const actor: Actor = {
      id: row.id,
      kind: row.kind,
      name: row.name,
      userId: row.userId,
    };
    const originUserId =
      caller.originUserId === undefined ? row.userId : caller.originUserId;
    return { actor, originUserId };
  };

  const unknownActor = failures.forbidden(
    "actor.active",
    "The caller isn't a known, active actor"
  ).error;

  const dalFor = (executor: Db | Tx, actor: Actor) =>
    createDataAccess({
      executor,
      canRead: (object) => permissions.canRead(actor, object),
    });

  /** Writes a failed action's action_log row, in its own transaction. */
  const logFailure = async (
    action: AnyActionDefinition,
    actor: Actor,
    originUserId: string | null,
    input: unknown,
    error: RunError,
    status: "failed" | "pending_approval" = "failed"
  ) => {
    const now = clock.now();
    const [row] = await db
      .insert(actionLog)
      .values({
        name: action.name,
        actorId: actor.id,
        originUserId,
        input: input ?? null,
        error,
        status,
        configSha: config.sha,
        createdAt: now,
        completedAt: now,
      })
      .returning({ id: actionLog.id });
    return row?.id ?? null;
  };

  /** Runs `action` for `caller`. Never throws for a failed action. */
  const run = async (
    action: AnyActionDefinition,
    input: unknown,
    caller: Caller
  ): Promise<ActionResult> => {
    const who = await identify(caller);
    if (!who) {
      return { ok: false, error: unknownActor, actionId: null };
    }
    const { actor, originUserId } = who;
    const fail = async (error: RunError, status?: "pending_approval") => ({
      ok: false as const,
      error,
      actionId: await logFailure(
        action,
        actor,
        originUserId,
        input,
        error,
        status
      ),
    });

    // 2. Validate.
    const parsed = action.input.safeParse(input);
    if (!parsed.success) {
      return fail(failures.invalidInput(parsed.error).error);
    }
    // 4. Authorise.
    const denied = await permissions.authorise(actor, action);
    if (denied) {
      return fail(denied.error);
    }
    // 5. Approve: phase 2 parks the action; until then no rule matches.
    const rule = await approvals(action, parsed.data, actor);
    if (rule) {
      return fail(failures.needsApproval(rule).error, "pending_approval");
    }

    // 6–8. Run, record and commit, together or not at all.
    try {
      return await withTransaction(db, async (tx) => {
        const [logged] = await tx
          .insert(actionLog)
          .values({
            name: action.name,
            actorId: actor.id,
            originUserId,
            input: input ?? null,
            status: "succeeded",
            configSha: config.sha,
            createdAt: clock.now(),
          })
          .returning({ id: actionLog.id });
        const actionId = logged?.id ?? "";
        const { ctx, events } = createActionContext(action, {
          repo: createRepository({
            executor: tx,
            actionId,
            actorId: actor.id,
            now: clock.now,
          }),
          dal: dalFor(tx, actor),
          config,
          clock,
          actor,
          originUserId,
        });

        const returned = await action.handler(ctx, parsed.data);
        if (isActionFailure(returned)) {
          throw new RollbackError(returned);
        }
        const output = action.output.safeParse(returned);
        if (!output.success) {
          throw new Error(
            `${action.name} returned output that doesn't fit its schema:\n${z.prettifyError(output.error)}`
          );
        }

        // 7. Record.
        const emitted = events();
        if (emitted.length > 0) {
          await tx.insert(eventLog).values(
            emitted.map((event) => ({
              type: event.type,
              payload: event.payload,
              actionId,
              originUserId,
              depth: 0,
              createdAt: clock.now(),
            }))
          );
        }
        await tx
          .update(actionLog)
          .set({ result: output.data, completedAt: clock.now() })
          .where(eq(actionLog.id, actionId));
        return {
          ok: true as const,
          output: output.data,
          actionId,
          events: emitted,
        };
      });
    } catch (error_) {
      const { error, logged } = errorFrom(error_);
      const actionId = await logFailure(
        action,
        actor,
        originUserId,
        input,
        logged
      );
      return { ok: false, error, actionId };
    }
  };

  /** Runs `query` for `caller`. Queries write nothing, not even a log row. */
  const query = async (
    definition: AnyQueryDefinition,
    input: unknown,
    caller: Caller
  ): Promise<QueryResult> => {
    const who = await identify(caller);
    if (!who) {
      return { ok: false, error: unknownActor };
    }
    const { actor, originUserId } = who;
    const parsed = definition.input.safeParse(input);
    if (!parsed.success) {
      return { ok: false, error: failures.invalidInput(parsed.error).error };
    }
    const denied = await permissions.authorise(actor, definition);
    if (denied) {
      return { ok: false, error: denied.error };
    }
    try {
      const ctx = createQueryContext({
        dal: dalFor(db, actor),
        config,
        clock,
        actor,
        originUserId,
      });
      const returned = await definition.handler(ctx, parsed.data);
      if (isActionFailure(returned)) {
        return { ok: false, error: returned.error };
      }
      return { ok: true, output: definition.output.parse(returned) };
    } catch (error) {
      return { ok: false, error: errorFrom(error).error };
    }
  };

  return { run, query };
};

export type Pipeline = ReturnType<typeof createPipeline>;
