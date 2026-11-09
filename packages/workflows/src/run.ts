// The runner (P2.17; decisions 0045, 0046 and 0048): runs a workflow with
// no pauses in one transaction, under the service key. Action steps run in
// that transaction (P2.15's runInternalStep); `if` takes a branch; `run`
// runs a nested workflow in the same transaction, as a child run; `emit`
// writes an event; `fail` ends the run with a declared error; `output`
// ends it with the output. Any failure rolls everything back.
//
// The engine is the only writer of the trace. It inserts each run, and each
// step that changes data, as it starts, since history points at them; the
// rest of the trace and the events are written once, as the transaction
// ends. After a rollback the trace is written again, so a failed run keeps
// it.
// The workflow is the run's actor and the caller its origin user (AGENTS.md
// rule 13). Waits, approvals and external actions come with P2.20.
import { randomUUID } from "node:crypto";
import { isDeepStrictEqual } from "node:util";

import { failures, runInternalStep } from "@workspace/actions";
import type {
  ActionError,
  Actor,
  AnyActionDefinition,
  Clock,
  ConfigService,
  DeclaredError,
} from "@workspace/actions";
import { createIdentityStore, isUniqueViolation } from "@workspace/db";
import type { Db, Tx } from "@workspace/db";
import type { z } from "zod";

import { schemaOf } from "./fields.ts";
import type { FieldSpecs } from "./fields.ts";
import { operatorOf } from "./schema.ts";
import type { Condition, Source, Step, WorkflowDefinition } from "./schema.ts";
import { Trace } from "./trace.ts";
import type { RunStepRow as StepRow } from "./trace.ts";

export type RunError = ActionError | DeclaredError;

export type WorkflowResult =
  | { ok: true; runId: string; output: Record<string, unknown> }
  | {
      ok: false;
      runId: string;
      error: RunError;
      /** It had already run for this event or minute, so nothing ran (P2.19). */
      duplicate?: true;
    };

/** How a run started when nobody called it (P2.19). */
export interface RunStart {
  /** The event that started it, and its payload, read as `event.…`. */
  readonly event?: { readonly id: string; readonly payload: unknown };
  /** The event's fields, when a workflow declares it: for choice columns. */
  readonly eventSpecs?: FieldSpecs | undefined;
  /** The run that emitted the event. */
  readonly parentRunId?: string | null;
  readonly depth?: number;
  /** The minute a schedule started it for. */
  readonly scheduledFor?: Date;
}

export interface RunnerOptions {
  readonly db: Db;
  /** The actions steps run, by name: `System.stepActions`. */
  readonly actions: ReadonlyMap<string, AnyActionDefinition>;
  readonly clock: Clock;
}

export interface WorkflowRunOptions {
  /** The person at the start of the chain; null for a schedule. */
  readonly originUserId: string | null;
  /** The config the run is pinned to, and its definitions came from. */
  readonly config: ConfigService;
  /** Other workflows a `run` step names, from the same config, by key. */
  readonly workflows?: ReadonlyMap<string, WorkflowDefinition>;
  /** Payload schemas of events the system already has, for `emit`. */
  readonly events?: ReadonlyMap<string, z.ZodType>;
  /** The caller's retry key, kept on the top run (P2.18). */
  readonly retryKey?: string;
  /** How it started, when an event or a schedule started it (P2.19). */
  readonly start?: RunStart;
}

/** Nested runs deeper than this stop: a loop of workflows running each other. */
export const maxDepth = 8;

/** Carries a run's error out of its transaction, rolling it back. */
class RunFailedError extends Error {
  readonly failure: RunError;
  constructor(failure: RunError) {
    super(failure.message);
    this.name = "RunFailedError";
    this.failure = failure;
  }
}

/** The value `keys` below `value`, or undefined. */
const dig = (value: unknown, keys: readonly string[]): unknown => {
  let here = value;
  for (const key of keys) {
    if (typeof here !== "object" || here === null) {
      return undefined;
    }
    here = (here as Record<string, unknown>)[key];
  }
  return here;
};

const isEmpty = (value: unknown) =>
  value === null ||
  value === undefined ||
  (typeof value === "string" && value.trim() === "") ||
  (Array.isArray(value) && value.length === 0);

const numberTests: Record<string, (actual: number, limit: number) => boolean> =
  {
    above: (actual, limit) => actual > limit,
    at_least: (actual, limit) => actual >= limit,
    below: (actual, limit) => actual < limit,
    at_most: (actual, limit) => actual <= limit,
  };

/** Whether `actual` passes one condition's operator and value. */
const passes = (condition: Condition, actual: unknown) => {
  const { operator, value } = operatorOf(condition);
  const same = (each: unknown) => isDeepStrictEqual(actual, each);
  switch (operator) {
    case "is": {
      return same(value);
    }
    case "is_not": {
      return !same(value);
    }
    case "one_of": {
      return (value as unknown[]).some(same);
    }
    case "not_one_of": {
      return !(value as unknown[]).some(same);
    }
    case "empty": {
      return isEmpty(actual) === value;
    }
    default: {
      const test = numberTests[operator];
      return typeof actual === "number" && test !== undefined
        ? test(actual, value as number)
        : false;
    }
  }
};

/** One run of one workflow: what it can read, and what it has done. */
interface Frame {
  readonly workflow: WorkflowDefinition;
  readonly runId: string;
  readonly actor: Actor;
  readonly depth: number;
  readonly input: Readonly<Record<string, unknown>>;
  /** The event that started the run, for a top run an event started. */
  readonly event?: RunStart | undefined;
  /** Each step's output, by id. */
  readonly outputs: Map<string, unknown>;
}

/** What `path` reads; a choice's column comes from the pinned config. */
/** The option `value` names in the choice list `list`, as config has it. */
const optionOf = (config: ConfigService, list: string, value: unknown) =>
  config.choices?.(list)?.find((each) => each.key === value);

const read = (
  path: string,
  frame: Pick<Frame, "input" | "outputs" | "workflow" | "event">,
  config: ConfigService
) => {
  const [root, first = "", ...rest] = path.split(".");
  if (root === "steps") {
    return dig(frame.outputs.get(first), rest.slice(1));
  }
  const fromEvent = root === "event";
  const value = fromEvent
    ? dig(frame.event?.event?.payload, [first])
    : frame.input[first];
  const spec = fromEvent
    ? frame.event?.eventSpecs?.[first]
    : frame.workflow.input?.[first];
  if (spec?.type === "choice" && rest.length > 0) {
    return dig(optionOf(config, spec.list, value), rest);
  }
  return dig(value, rest);
};

const valueOf = (source: Source, frame: Frame, config: ConfigService) =>
  "value" in source ? source.value : read(source.from, frame, config);

/** A step's `with`, leaving out values that came out undefined. */
const given = (
  values: Readonly<Record<string, Source>> | undefined,
  frame: Frame,
  config: ConfigService
) =>
  Object.fromEntries(
    Object.entries(values ?? {})
      .map(([key, source]) => [key, valueOf(source, frame, config)] as const)
      .filter(([, value]) => value !== undefined)
  );

/** Checks the input, and that each choice is an option chosen now. */
const parseInput = (
  workflow: WorkflowDefinition,
  input: unknown,
  config: ConfigService
): Record<string, unknown> => {
  const parsed = schemaOf(workflow.input).safeParse(input);
  if (!parsed.success) {
    throw new RunFailedError(failures.invalidInput(parsed.error).error);
  }
  for (const [name, spec] of Object.entries(workflow.input ?? {})) {
    const value = parsed.data[name];
    if (spec.type !== "choice" || value === null || value === undefined) {
      continue;
    }
    const option = config
      .choices?.(spec.list)
      ?.find((each) => each.key === value);
    if (!option || option.archived) {
      throw new RunFailedError(
        failures.invalid(
          `"${String(value)}" isn't a ${spec.list} option that can be chosen.`,
          [{ path: [name], message: `Not an option of ${spec.list}` }]
        ).error
      );
    }
  }
  return parsed.data;
};

/** What every frame of one run shares. */
interface Shared {
  readonly tx: Tx;
  readonly trace: Trace;
  readonly options: WorkflowRunOptions;
}

type Ended = { output: Record<string, unknown> } | null;

/**
 * A runner over a system's step actions. It finds each workflow's actor
 * once, then runs workflows with `run`.
 */
export const createRunner = ({ db, actions, clock }: RunnerOptions) => {
  const actorIds = new Map<string, Actor>();
  const identity = createIdentityStore(db);

  /** The workflow's own actor, outside any run so a failed run has it. */
  const actorOf = async (key: string): Promise<Actor> => {
    const known = actorIds.get(key);
    if (known) {
      return known;
    }
    const row = await identity.workflowActor(key);
    const actor: Actor = {
      id: row.id,
      kind: "automation",
      name: row.name,
      userId: null,
    };
    actorIds.set(key, actor);
    return actor;
  };

  const stepRow = (
    frame: Frame,
    stepId: string,
    kind: "action" | "control",
    name: string,
    input: unknown
  ): StepRow => ({
    id: randomUUID(),
    runId: frame.runId,
    stepId,
    kind,
    name,
    input: input ?? null,
    startedAt: clock.now(),
  });

  /** Fails the run with `error`, recorded on the step `row`. */
  const failStep = (shared: Shared, row: StepRow, error: RunError): never => {
    shared.trace.endStep(row.id, { error, finishedAt: clock.now() });
    throw new RunFailedError(error);
  };

  const actionStep = async (
    shared: Shared,
    step: Extract<Step, { action: string }>,
    frame: Frame
  ) => {
    const action = actions.get(step.action);
    if (!action) {
      throw new Error(`There is no action "${step.action}".`);
    }
    if (action.kind === "external") {
      throw new Error(
        `${frame.workflow.key} runs the external action ${action.name}; external steps come with P2.20.`
      );
    }
    const { tx, trace, options } = shared;
    const input = given(step.with, frame, options.config);
    const row = stepRow(frame, step.id, "action", action.name, input);
    await trace.startStep(tx, row);
    const result = await runInternalStep(tx, action, input, {
      place: { runId: frame.runId, stepId: step.id, rowId: row.id },
      actor: frame.actor,
      originUserId: options.originUserId,
      config: options.config,
      clock,
    });
    if (!result.ok) {
      return failStep(shared, row, result.error);
    }
    trace.addEvents(
      result.events.map((event) => ({
        type: event.type,
        payload: event.payload,
        runId: frame.runId,
        stepId: row.id,
        originUserId: options.originUserId,
        depth: frame.depth,
        createdAt: clock.now(),
      }))
    );
    frame.outputs.set(step.id, result.output);
    trace.endStep(row.id, {
      output: result.output ?? null,
      finishedAt: clock.now(),
    });
  };

  const emitStep = (
    shared: Shared,
    step: Extract<Step, { emit: string }>,
    frame: Frame
  ) => {
    const { trace, options } = shared;
    const payload = given(step.with, frame, options.config);
    const row = stepRow(frame, step.id, "control", "emit", payload);
    trace.addStep(row);
    const declared = frame.workflow.events?.[step.emit];
    const schema = declared
      ? schemaOf(declared)
      : options.events?.get(step.emit);
    const parsed = schema?.safeParse(payload);
    if (parsed && !parsed.success) {
      return failStep(
        shared,
        row,
        failures.invalidInput(
          parsed.error,
          `The ${step.emit} event's payload isn't valid`
        ).error
      );
    }
    trace.addEvents([
      {
        type: step.emit,
        payload: parsed?.data ?? payload,
        runId: frame.runId,
        stepId: row.id,
        originUserId: options.originUserId,
        depth: frame.depth,
        createdAt: clock.now(),
      },
    ]);
    trace.endStep(row.id, { finishedAt: clock.now() });
  };

  const ifStep = (
    shared: Shared,
    step: Extract<Step, { if: readonly Condition[] }>,
    frame: Frame
  ): Promise<Ended> => {
    const { config } = shared.options;
    const seen = Object.fromEntries(
      step.if.map((condition) => [
        condition.field,
        read(condition.field, frame, config) ?? null,
      ])
    );
    const taken = step.if.every((condition) =>
      passes(condition, seen[condition.field])
    )
      ? "then"
      : "else";
    shared.trace.addStep({
      ...stepRow(frame, step.id, "control", "if", seen),
      branch: taken,
      finishedAt: clock.now(),
    });
    const branch = taken === "then" ? step.then : (step.else ?? []);
    // oxlint-disable-next-line eslint/no-use-before-define -- recursive
    return walk(shared, branch, frame, `${step.id}.${taken}`);
  };

  const runStep = async (
    shared: Shared,
    step: Extract<Step, { run: string }>,
    frame: Frame
  ) => {
    const { trace, options } = shared;
    const child = options.workflows?.get(step.run);
    if (!child) {
      throw new Error(`There is no workflow "${step.run}".`);
    }
    const input = given(step.with, frame, options.config);
    const row = stepRow(frame, step.id, "control", "run", input);
    // The child run points at its parent run, not at this step.
    trace.addStep(row);
    try {
      // oxlint-disable-next-line eslint/no-use-before-define -- recursive
      const output = await execute(shared, child, input, {
        parentRunId: frame.runId,
        depth: frame.depth + 1,
      });
      frame.outputs.set(step.id, output);
      trace.endStep(row.id, { output, finishedAt: clock.now() });
    } catch (error) {
      if (error instanceof RunFailedError) {
        failStep(shared, row, error.failure);
      }
      throw error;
    }
  };

  /** Runs one step; what it ends the run with, if it does. */
  const one = async (
    shared: Shared,
    step: Step,
    frame: Frame,
    where: string
  ): Promise<Ended> => {
    const { config } = shared.options;
    if ("action" in step) {
      await actionStep(shared, step, frame);
      return null;
    }
    if ("if" in step) {
      return ifStep(shared, step, frame);
    }
    if ("run" in step) {
      await runStep(shared, step, frame);
      return null;
    }
    if ("emit" in step) {
      emitStep(shared, step, frame);
      return null;
    }
    if ("fail" in step) {
      const message =
        step.message ?? frame.workflow.errors?.[step.fail] ?? step.fail;
      const row = stepRow(frame, step.id ?? where, "control", "fail", null);
      shared.trace.addStep(row);
      return failStep(shared, row, {
        code: step.fail,
        message,
        declared: true,
      });
    }
    if ("output" in step) {
      const output = given(step.output, frame, config);
      const row = stepRow(frame, step.id ?? where, "control", "output", null);
      shared.trace.addStep({
        ...row,
        output,
        finishedAt: clock.now(),
      });
      return { output };
    }
    throw new Error(
      `${frame.workflow.key} pauses at ${step.id}; runs with pauses come with P2.20.`
    );
  };

  /** Runs `steps` in order; what ends the run, if one does. */
  const walk = async (
    shared: Shared,
    steps: readonly Step[],
    frame: Frame,
    where: string
  ): Promise<Ended> => {
    for (const [index, step] of steps.entries()) {
      // Steps run one after another: each may read what the last did.
      // oxlint-disable-next-line eslint/no-await-in-loop
      const ended = await one(shared, step, frame, `${where}.${index}`);
      if (ended) {
        return ended;
      }
    }
    return null;
  };

  /** Runs `workflow` as a run of its own in the shared transaction. */
  const execute = async (
    shared: Shared,
    workflow: WorkflowDefinition,
    input: unknown,
    place: {
      parentRunId: string | null;
      depth: number;
      runId?: string;
      /** The top run: it carries the retry key and how it started. */
      start?: RunStart;
    }
  ): Promise<Record<string, unknown>> => {
    const { tx, trace, options } = shared;
    const actor = await actorOf(workflow.key);
    const runId = place.runId ?? randomUUID();
    await trace.startRun(tx, {
      id: runId,
      endpoint: workflow.key,
      actorId: actor.id,
      originUserId: options.originUserId,
      input: input ?? {},
      status: "running",
      configSha: options.config.sha,
      retryKey: place.start ? (options.retryKey ?? null) : null,
      eventId: place.start?.event?.id ?? null,
      scheduledFor: place.start?.scheduledFor ?? null,
      parentRunId: place.parentRunId,
      depth: place.depth,
      startedAt: clock.now(),
    });
    if (place.depth > maxDepth) {
      throw new RunFailedError(
        failures.conflict(
          `${workflow.key} is ${place.depth} runs deep, past the limit of ${maxDepth}: workflows may be running each other in a loop.`
        ).error
      );
    }
    const frame: Frame = {
      workflow,
      runId,
      actor,
      depth: place.depth,
      input: parseInput(workflow, input, options.config),
      event: place.start,
      outputs: new Map(),
    };
    const ended = await walk(shared, workflow.steps, frame, "steps");
    const output =
      ended?.output ?? given(workflow.output, frame, options.config);
    trace.endRun(runId, {
      status: "succeeded",
      output,
      finishedAt: clock.now(),
    });
    return output;
  };

  /**
   * Runs `workflow` with `input`, all in one transaction: its output, or
   * the typed error that rolled it back. Either way the run is traced.
   */
  const run = async (
    workflow: WorkflowDefinition,
    input: unknown,
    options: WorkflowRunOptions
  ): Promise<WorkflowResult> => {
    const trace = new Trace();
    const runId = randomUUID();
    await actorOf(workflow.key);
    try {
      const output = await db.transaction(async (tx) => {
        const start = options.start ?? {};
        const ended = await execute({ tx, trace, options }, workflow, input, {
          parentRunId: start.parentRunId ?? null,
          depth: start.depth ?? 0,
          runId,
          start,
        });
        await trace.finish(tx);
        return ended;
      });
      return { ok: true, runId, output };
    } catch (error) {
      if (
        isUniqueViolation(error, "runs_event_unique") ||
        isUniqueViolation(error, "runs_schedule_unique")
      ) {
        // Another dispatcher started it first; this one never ran.
        return {
          ok: false,
          runId,
          error: failures.conflict(
            `${workflow.key} has already run for this ${options.start?.event ? "event" : "minute"}`
          ).error,
          duplicate: true,
        };
      }
      if (error instanceof RunFailedError) {
        await trace.rewrite(db, error.failure, clock.now());
        return { ok: false, runId, error: error.failure };
      }
      await trace.rewrite(
        db,
        { code: "internal", message: String(error) },
        clock.now()
      );
      throw error;
    }
  };

  return { run, actorOf };
};

export type Runner = ReturnType<typeof createRunner>;

/**
 * Whether `event` starts `workflow`: its `starts_when` names the event's
 * type and every `when` condition holds on the payload (P2.19).
 */
export const startsOn = (
  workflow: WorkflowDefinition,
  event: { readonly type: string; readonly payload: unknown },
  config: ConfigService,
  eventSpecs?: FieldSpecs
) => {
  const starts = workflow.starts_when;
  if (typeof starts !== "object" || !("event" in starts)) {
    return false;
  }
  if (starts.event !== event.type) {
    return false;
  }
  const frame = {
    workflow,
    input: {},
    outputs: new Map<string, unknown>(),
    event: { event: { id: "", payload: event.payload }, eventSpecs },
  };
  return (starts.when ?? []).every((condition) =>
    passes(condition, read(condition.field, frame, config) ?? null)
  );
};
