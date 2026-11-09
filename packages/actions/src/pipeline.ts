// The action pipeline: every action, whoever calls it, runs identify,
// validate, authorise, approve, run, record and commit in one transaction.
// Queries run identify, validate, authorise and run. An action an approval
// rule matches is parked as pending_approval, and runs once it's approved
//. See docs/SYSTEM_DESIGN.md section 4.2 and decisions 0020, 0021
// and 0042.

import { isDeepStrictEqual } from "node:util";

import {
  actionLog,
  actors,
  auditLog,
  createApprovalStore,
  createDraftStore,
  createIdentityStore,
  eventLog,
  withTransaction,
} from "@workspace/db";
import type { Db, Tx } from "@workspace/db";
import {
  ChoiceValueError,
  createDataAccess,
  createRepository,
} from "@workspace/objects";
import type { AnyChoiceList, AnyObjectDefinition } from "@workspace/objects";
import { and, eq } from "drizzle-orm";
import { z } from "zod";

import {
  describeSignOffs,
  rulesForAction,
  signOffsFor,
  unmetSignOff,
} from "./approval-rules.ts";
import type { SignOff } from "./approval-rules.ts";
import { createActionContext, createQueryContext } from "./context.ts";
import type { EmittedEvent } from "./context.ts";
import { choiceList } from "./define-action.ts";
import type {
  Actor,
  AnyActionDefinition,
  AnyQueryDefinition,
  ApprovalService,
  Clock,
  ConfigService,
  GitService,
  ResumeResult,
} from "./define-action.ts";
import { allGranted } from "./describe.ts";
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

export interface PipelineOptions {
  db: Db;
  config: ConfigService;
  /** The config remote, for drafts ; absent when config is local. */
  git?: GitService;
  clock: Clock;
  permissions?: Permissions;
  /**
   * Finds an action by name, to run a pending one once it's approved.
   * Without it, an approved action fails as no longer known.
   */
  actions?: (name: string) => AnyActionDefinition | undefined;
  /**
   * The system's objects, so approval rules can test the record an action
   * acts on (decision 0043). A rule naming another object sees no record.
   */
  objects?: readonly AnyObjectDefinition[];
}

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
  // The repository refused a choice the loaded options don't allow.
  if (thrown instanceof ChoiceValueError) {
    const { error } = failures.invalid(thrown.message, [
      { path: [thrown.field], message: thrown.message },
    ]);
    return { error, logged: error };
  }
  const message = thrown instanceof Error ? thrown.message : String(thrown);
  return {
    error: internal(
      "The action failed unexpectedly. Its action_log row has the details."
    ),
    logged: internal(message),
  };
};

const dalFor = (executor: Db | Tx, granted: Granted, config: ConfigService) =>
  createDataAccess({
    executor,
    canRead: granted.canRead,
    choices: config.choices,
  });

/** One run's who, what and how. */
interface RunState {
  action: AnyActionDefinition;
  granted: Granted;
  input: unknown;
  actor: Actor;
  originUserId: string | null;
  options: RunOptions;
  /** The config version this run reads, pinned when it starts. */
  config: ConfigService;
}

/**
 * The config as it is now. A loader swaps versions while runs go on, so a
 * run takes one snapshot and reads only that.
 */
const pin = (config: ConfigService): ConfigService => {
  const { choices } = config;
  return {
    sha: config.sha,
    roles: config.roles,
    // A loader's `choices` reads the version live when it's read, so this
    // keeps that version's lookup. `choice` reads the same snapshot.
    ...(choices
      ? {
          choices,
          choice: <TList extends AnyChoiceList>(list: TList) =>
            choiceList(choices, list),
        }
      : {}),
    ...(config.approvals ? { approvals: config.approvals } : {}),
    ...(config.validate ? { validate: config.validate } : {}),
  };
};

/** The columns every action_log row for this run has. */
const rowFor = (state: RunState) => ({
  name: state.action.name,
  actorId: state.actor.id,
  originUserId: state.originUserId,
  input: state.input ?? null,
  retryKey: state.options.retryKey ?? null,
  dryRun: state.options.dryRun ?? false,
  configSha: state.config.sha,
});

export const createPipeline = ({
  db,
  config,
  clock,
  git,
  permissions = allowAll,
  actions,
  objects = [],
}: PipelineOptions) => {
  /**
   * Reads a record for approval rules, archived or not, whoever is acting:
   * the rule is policy, so it sees what the actor might not.
   */
  const readRecord = async (
    executor: Db | Tx,
    pinned: ConfigService,
    name: string,
    id: string
  ) => {
    const object = objects.find((each) => each.name === name);
    if (!object) {
      return null;
    }
    const found = await dalFor(executor, allGranted, pinned).get(object, id, {
      archived: "include",
    });
    return found?.record ?? null;
  };

  /** The sign-offs the rules on `action` ask of `who` for `input` now. */
  const signOffsOf =
    (
      who: { actor: Actor; granted: Granted; config: ConfigService },
      executor: Db | Tx
    ) =>
    async (action: string, input: unknown): Promise<SignOff[]> =>
      signOffsFor(
        await rulesForAction(
          who.config.approvals ?? [],
          action,
          input,
          (name, id) => readRecord(executor, who.config, name, id)
        ),
        who.actor,
        who.granted
      );

  /** The sign-offs the rules on `state.action` ask of its actor now. */
  const signOffsNow = (state: RunState, input: unknown, executor: Db | Tx) =>
    signOffsOf(state, executor)(state.action.name, input);

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

  /** Writes a finished row outside the run's (rolled-back) transaction. */
  const writeRow = async (
    state: RunState,
    outcome:
      | { status: "failed"; error: RunError }
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

  const fail = async (state: RunState, error: RunError) => ({
    ok: false as const,
    error,
    actionId: await writeRow(state, { status: "failed", error }),
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

  /**
   * 6–7. Runs the handler in `tx` and records what it did against the
   * action_log row `actionId`. A typed failure throws, to roll `tx` back.
   */
  const perform = async (
    tx: Tx,
    state: RunState,
    input: unknown,
    actionId: string,
    approvals: ApprovalService
  ): Promise<Success> => {
    const { action, actor, originUserId } = state;
    const dryRun = state.options.dryRun ?? false;
    const { ctx, events } = createActionContext(action, {
      repo: createRepository({
        executor: tx,
        actionId,
        actorId: actor.id,
        now: clock.now,
        choices: state.config.choices,
      }),
      identity: createIdentityStore(tx),
      drafts: createDraftStore(tx),
      approvals,
      dryRun,
      dal: dalFor(tx, state.granted, state.config),
      granted: state.granted,
      config: state.config,
      git,
      clock,
      actor,
      originUserId,
      signOffs: signOffsOf(state, tx),
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
        status: "succeeded",
        result: redacted(action, output.data),
        error: null,
        configSha: state.config.sha,
        completedAt: clock.now(),
      })
      .where(eq(actionLog.id, actionId));
    return {
      ok: true,
      output: output.data,
      actionId,
      events: emitted,
      replayed: false,
      dryRun,
    };
  };

  /**
   * Runs the pending action `actionId` inside `tx`, the approving run's
   * transaction, as the actor who asked. Its permissions and input
   * are checked again, since either may have changed while it waited. A
   * failure rolls back only its own savepoint and marks the row failed.
   */
  const resume = async (
    tx: Tx,
    actionId: string,
    dryRun: boolean,
    approvals: ApprovalService,
    /** `ctx.approvals` for the resumed run, as its own actor. */
    approvalsFor: (executor: Tx, resumed: RunState) => ApprovalService
  ): Promise<ResumeResult> => {
    const [row] = await tx
      .select()
      .from(actionLog)
      .where(eq(actionLog.id, actionId))
      .for("update");
    if (!row || row.status !== "pending_approval") {
      throw new Error(`Action ${actionId} isn't waiting for approval.`);
    }
    const failed = async (logged: RunError, error: RunError = logged) => {
      await tx
        .update(actionLog)
        .set({ status: "failed", error: logged, completedAt: clock.now() })
        .where(eq(actionLog.id, actionId));
      return { ok: false as const, error };
    };
    const action = actions?.(row.name);
    if (!action) {
      return failed(internal(`This system no longer has ${row.name}.`));
    }
    const who = await identify({
      actorId: row.actorId,
      originUserId: row.originUserId,
    });
    if (!who) {
      return failed(unknownActor);
    }
    const granted = await permissions.load(who.actor);
    const parsed = action.input.safeParse(row.input);
    if (!parsed.success) {
      return failed(failures.invalidInput(parsed.error).error);
    }
    const denied = granted.authorise(action);
    if (denied) {
      return failed(denied.error);
    }
    const state: RunState = {
      action,
      input: row.input,
      granted,
      ...who,
      options: { dryRun },
      config: pin(config),
    };
    // The rules, the record or the actor's roles may have changed while it
    // waited, so what it needs now must already be approved.
    const unmet = unmetSignOff(
      await signOffsNow(state, parsed.data, tx),
      await approvals.forSubject("action", actionId)
    );
    if (unmet) {
      return failed(
        failures.needsApproval(
          unmet.ruleKey,
          `While this waited, it came to need ${describeSignOffs([unmet])} (rule ${unmet.ruleKey}), which it doesn't have. Ask again.`
        ).error
      );
    }
    try {
      const done = await withTransaction(tx, (savepoint) =>
        perform(
          savepoint,
          state,
          parsed.data,
          actionId,
          approvalsFor(savepoint, state)
        )
      );
      return { ok: true, output: done.output };
    } catch (error_) {
      const { error, logged } = errorFrom(error_);
      return failed(logged, error);
    }
  };

  /** `ctx.approvals` for a run of `state` in `tx`. */
  const approvalsIn = (tx: Tx, state: RunState): ApprovalService => {
    const dryRun = state.options.dryRun ?? false;
    const service: ApprovalService = {
      ...createApprovalStore(tx),
      resume: (actionId) => resume(tx, actionId, dryRun, service, approvalsIn),
      close: async (actionId, status = "rejected") => {
        await tx
          .update(actionLog)
          .set({ status, completedAt: clock.now() })
          .where(
            and(
              eq(actionLog.id, actionId),
              eq(actionLog.status, "pending_approval")
            )
          );
      },
      park: async () => {
        const [row] = await tx
          .insert(actionLog)
          .values({
            ...rowFor(state),
            // A parked call is never replayed by its retry key.
            retryKey: null,
            status: "pending_approval",
            createdAt: clock.now(),
          })
          .returning({ id: actionLog.id });
        if (!row) {
          throw new Error("insert returned no action_log row");
        }
        return row.id;
      },
    };
    return service;
  };

  /** 6–8. Run, record and commit, together or not at all. */
  const execute = (state: RunState, input: unknown): Promise<Success> =>
    withTransaction(db, async (tx) => {
      const [logged] = await tx
        .insert(actionLog)
        .values({
          ...rowFor(state),
          status: "succeeded",
          createdAt: clock.now(),
        })
        .returning({ id: actionLog.id });
      const actionId = logged?.id ?? "";
      const result = await perform(
        tx,
        state,
        input,
        actionId,
        approvalsIn(tx, state)
      );
      if (result.dryRun) {
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

  /**
   * 5. Parks the run: its pending_approval row and one approval per rule,
   * together. A dry run only reports that it would wait.
   */
  const park = async (
    state: RunState,
    signOffs: SignOff[]
  ): Promise<ActionResult> => {
    const [first] = signOffs;
    const { error } = failures.needsApproval(
      first?.ruleKey ?? "",
      `This waits for ${describeSignOffs(signOffs)} (${signOffs.length === 1 ? "rule" : "rules"} ${signOffs.map((each) => each.ruleKey).join(", ")}). It runs once approved.`
    );
    if (state.options.dryRun) {
      return fail(state, error);
    }
    const actionId = await withTransaction(db, async (tx) => {
      const [row] = await tx
        .insert(actionLog)
        .values({
          ...rowFor(state),
          status: "pending_approval",
          error,
          createdAt: clock.now(),
        })
        .returning({ id: actionLog.id });
      if (!row) {
        throw new Error("insert returned no action_log row");
      }
      await createApprovalStore(tx).request(
        "action",
        row.id,
        signOffs,
        state.actor.id
      );
      return row.id;
    });
    return { ok: false, error, actionId };
  };

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
    const state: RunState = {
      action,
      input,
      granted,
      ...who,
      options,
      config: pin(config),
    };

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
    // 5. Approve: a matching rule parks the action until it's decided.
    const signOffs = await signOffsNow(state, parsed.data, db);
    if (signOffs.length > 0) {
      return park(state, signOffs);
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
    const pinned = pin(config);
    try {
      const ctx = createQueryContext({
        dal: dalFor(db, granted, pinned),
        granted,
        config: pinned,
        git,
        clock,
        actor,
        originUserId,
        signOffs: signOffsOf({ actor, granted, config: pinned }, db),
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
