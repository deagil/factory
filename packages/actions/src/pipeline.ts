// The action pipeline: every action, whoever calls it, runs identify,
// validate, authorise, approve, run, record and commit in one transaction.
// Queries run identify, validate, authorise and run. See
// docs/SYSTEM_DESIGN.md section 4.2 and decisions 0020 and 0021.

import { isDeepStrictEqual } from "node:util";

import {
  actionLog,
  actors,
  auditLog,
  createIdentityStore,
  eventLog,
  withTransaction,
} from "@workspace/db";
import type { Db, Tx } from "@workspace/db";
import { createDataAccess, createRepository } from "@workspace/objects";
import { and, eq } from "drizzle-orm";
import { z } from "zod";

import { createActionContext, createQueryContext } from "./context.ts";
import type { EmittedEvent } from "./context.ts";
import type {
  Actor,
  AnyActionDefinition,
  AnyQueryDefinition,
  Clock,
  ConfigService,
} from "./define-action.ts";
import { failures, isActionFailure } from "./errors.ts";
import type { ActionError, ActionFailure } from "./errors.ts";
import { allowAll } from "./permissions.ts";
import type { Granted, Permissions } from "./permissions.ts";

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

export interface RunOptions {
  /**
   * A key the caller chooses. A second run by the same actor with the same
   * key returns the first successful run's result without running again.
   */
  retryKey?: string;
  /** Run every stage, then roll back and report what would have happened. */
  dryRun?: boolean;
}

/** One record change, as its audit_log row has it. */
export interface RecordChange {
  object: string;
  recordId: string;
  before: unknown;
  after: unknown;
}

export type ActionResult =
  | {
      ok: true;
      output: unknown;
      /** The action_log row. */
      actionId: string;
      events: EmittedEvent[];
      /** True when a retry key matched an earlier run, which isn't run again. */
      replayed: boolean;
      dryRun: boolean;
      /** Dry runs only: the record changes that were rolled back. */
      changes?: RecordChange[];
    }
  /** `actionId` is null when the caller couldn't be identified. */
  | { ok: false; error: RunError; actionId: string | null };

type Success = Extract<ActionResult, { ok: true }>;

export type QueryResult =
  | { ok: true; output: unknown }
  | { ok: false; error: RunError };

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

const noRules: ApprovalRules = () => null;

/**
 * Rolls the run's transaction back, carrying out either the typed failure
 * the handler gave or, for a dry run, what would have happened.
 */
class RollbackError extends Error {
  readonly failure: ActionFailure | undefined;
  readonly dryRun: Success | undefined;
  constructor(carried: { failure: ActionFailure } | { dryRun: Success }) {
    super("failure" in carried ? carried.failure.error.message : "dry run");
    this.name = "RollbackError";
    this.failure = "failure" in carried ? carried.failure : undefined;
    this.dryRun = "dryRun" in carried ? carried.dryRun : undefined;
  }
}

const retryKeyIndex = "action_log_retry_key_unique";

/** Whether `thrown` is Postgres refusing a second success for a retry key. */
const isRetryKeyClash = (thrown: unknown): boolean => {
  let current: unknown = thrown;
  while (current instanceof Error) {
    const { code, constraint } = current as Error & {
      code?: string;
      constraint?: string;
    };
    if (code === "23505" && constraint === retryKeyIndex) {
      return true;
    }
    current = current.cause;
  }
  return false;
};

/** `output` with the action's secret keys replaced, for action_log. */
const redacted = (action: AnyActionDefinition, output: unknown) => {
  if (action.redact.length === 0 || typeof output !== "object" || !output) {
    return output;
  }
  const copy: Record<string, unknown> = { ...output };
  for (const key of action.redact) {
    if (key in copy) {
      copy[key] = "[redacted]";
    }
  }
  return copy;
};

/** A value as it comes back from a jsonb column. */
const asStored = (value: unknown): unknown =>
  // oxlint-disable-next-line unicorn/prefer-structured-clone -- the JSON round trip is the point
  JSON.parse(JSON.stringify(value ?? null));

const internal = (message: string): InternalError => ({
  code: "internal",
  message,
});

/** The error to record and return for whatever a run threw. */
const errorFrom = (thrown: unknown): { error: RunError; logged: RunError } => {
  if (thrown instanceof RollbackError && thrown.failure) {
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

const dalFor = (executor: Db | Tx, granted: Granted) =>
  createDataAccess({ executor, canRead: granted.canRead });

/** One run's who, what and how. */
interface RunState {
  action: AnyActionDefinition;
  granted: Granted;
  input: unknown;
  actor: Actor;
  originUserId: string | null;
  options: RunOptions;
}

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

  /** The columns every action_log row for this run has. */
  const rowFor = (state: RunState) => ({
    name: state.action.name,
    actorId: state.actor.id,
    originUserId: state.originUserId,
    input: state.input ?? null,
    retryKey: state.options.retryKey ?? null,
    dryRun: state.options.dryRun ?? false,
    configSha: config.sha,
  });

  /** Writes a finished row outside the run's (rolled-back) transaction. */
  const writeRow = async (
    state: RunState,
    outcome:
      | { status: "failed" | "pending_approval"; error: RunError }
      | { status: "succeeded"; result: unknown }
  ) => {
    const now = clock.now();
    const [row] = await db
      .insert(actionLog)
      .values({
        ...rowFor(state),
        ...outcome,
        createdAt: now,
        completedAt: now,
      })
      .returning({ id: actionLog.id });
    return row?.id ?? null;
  };

  const fail = async (
    state: RunState,
    error: RunError,
    status: "failed" | "pending_approval" = "failed"
  ) => ({
    ok: false as const,
    error,
    actionId: await writeRow(state, { status, error }),
  });

  /** 3. Retry key: the earlier success with this key, if there is one. */
  const replay = async (state: RunState): Promise<ActionResult | null> => {
    const { retryKey, dryRun } = state.options;
    if (retryKey === undefined || dryRun) {
      return null;
    }
    const [earlier] = await db
      .select()
      .from(actionLog)
      .where(
        and(
          eq(actionLog.actorId, state.actor.id),
          eq(actionLog.retryKey, retryKey),
          eq(actionLog.status, "succeeded"),
          eq(actionLog.dryRun, false)
        )
      );
    if (!earlier) {
      return null;
    }
    if (
      earlier.name !== state.action.name ||
      !isDeepStrictEqual(earlier.input, asStored(state.input))
    ) {
      return fail(
        state,
        failures.conflict(
          "This retry key was already used for a different call. Use a new key."
        ).error
      );
    }
    return {
      ok: true,
      output: earlier.result,
      actionId: earlier.id,
      events: [],
      replayed: true,
      dryRun: false,
    };
  };

  /** 6–8. Run, record and commit, together or not at all. */
  const execute = (state: RunState, input: unknown): Promise<Success> =>
    withTransaction(db, async (tx) => {
      const { action, actor, originUserId } = state;
      const dryRun = state.options.dryRun ?? false;
      const [logged] = await tx
        .insert(actionLog)
        .values({
          ...rowFor(state),
          status: "succeeded",
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
        identity: createIdentityStore(tx),
        dal: dalFor(tx, state.granted),
        granted: state.granted,
        config,
        clock,
        actor,
        originUserId,
      });

      const returned = await action.handler(ctx, input);
      if (isActionFailure(returned)) {
        throw new RollbackError({ failure: returned });
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
        .set({
          result: redacted(action, output.data),
          completedAt: clock.now(),
        })
        .where(eq(actionLog.id, actionId));
      const result: Success = {
        ok: true,
        output: output.data,
        actionId,
        events: emitted,
        replayed: false,
        dryRun,
      };
      if (dryRun) {
        const changes = await tx
          .select({
            object: auditLog.object,
            recordId: auditLog.recordId,
            before: auditLog.before,
            after: auditLog.after,
          })
          .from(auditLog)
          .where(eq(auditLog.actionId, actionId));
        throw new RollbackError({ dryRun: { ...result, changes } });
      }
      return result;
    });

  /** What a run that threw comes to: a dry run's report, a replay or a failure. */
  const settle = async (
    state: RunState,
    thrown: unknown
  ): Promise<ActionResult> => {
    if (thrown instanceof RollbackError && thrown.dryRun) {
      const actionId = await writeRow(state, {
        status: "succeeded",
        result: redacted(state.action, thrown.dryRun.output),
      });
      return { ...thrown.dryRun, actionId: actionId ?? "" };
    }
    if (isRetryKeyClash(thrown)) {
      // Another run with this key committed first; return its result.
      const earlier = await replay(state);
      if (earlier) {
        return earlier;
      }
    }
    const { error, logged } = errorFrom(thrown);
    const actionId = await writeRow(state, { status: "failed", error: logged });
    return { ok: false, error, actionId };
  };

  /** Runs `action` for `caller`. Never throws for a failed action. */
  const run = async (
    action: AnyActionDefinition,
    input: unknown,
    caller: Caller,
    options: RunOptions = {}
  ): Promise<ActionResult> => {
    const who = await identify(caller);
    if (!who) {
      return { ok: false, error: unknownActor, actionId: null };
    }
    const granted = await permissions.load(who.actor);
    const state: RunState = { action, input, granted, ...who, options };

    // 2. Validate.
    const parsed = action.input.safeParse(input);
    if (!parsed.success) {
      return fail(state, failures.invalidInput(parsed.error).error);
    }
    // 3. Retry key.
    const earlier = await replay(state);
    if (earlier) {
      return earlier;
    }
    // 4. Authorise.
    const denied = granted.authorise(action);
    if (denied) {
      return fail(state, denied.error);
    }
    // 5. Approve: phase 2 parks the action; until then no rule matches.
    const rule = await approvals(action, parsed.data, state.actor);
    if (rule) {
      return fail(
        state,
        failures.needsApproval(rule).error,
        "pending_approval"
      );
    }
    try {
      return await execute(state, parsed.data);
    } catch (error) {
      return settle(state, error);
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
    const granted = await permissions.load(actor);
    const denied = granted.authorise(definition);
    if (denied) {
      return { ok: false, error: denied.error };
    }
    try {
      const ctx = createQueryContext({
        dal: dalFor(db, granted),
        granted,
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
