// The runner (P2.17, P2.20; decisions 0045, 0046 and 0048): runs a workflow
// under the service key, in segments. A segment is the steps between pauses,
// run in one transaction: action steps (P2.15's runInternalStep), `if`,
// `run` of a workflow that doesn't pause (a child run in the same
// transaction), `emit`, `fail` and `output`. A workflow with no pauses and
// no external steps is one segment, with no checkpoints.
//
// A workflow that may pause or reach another system runs durably: it is a
// DBOS workflow (durable.ts) whose segments are DBOS steps. A segment ends
// at a pause: a `wait`, an external step whose output a later step reads,
// or a `run` of a workflow that may pause. It commits with a checkpoint on
// its run, the pause happens outside any transaction, and the next segment
// goes on from the step after it. External steps whose output nothing reads
// are queued and sent once their segment commits. An external step that
// fails with `unavailable` is tried again with backoff, always with the
// same retry key.
//
// A failure in the first segment rolls everything back, as in a run with no
// pauses. A failure after a commit rolls back only its own segment, then
// runs the `on_failure` steps that cover the failing step as a new segment;
// with none, or when they fail too, the run needs attention from the role
// the workflow names, who may retry it, run its failure steps, or mark it
// resolved (`attend`).
//
// The engine is the only writer of the trace. It inserts each run, and each
// step that changes data, as it starts, since history points at them; the
// rest of a segment's trace and its events are written as it commits. After
// a rollback the trace is written again, so a failed segment keeps it, with
// a `rolled_back` step saying what was undone. The workflow is the run's
// actor and the caller its origin user (AGENTS.md rule 13). Approvals come
// with P2.21.
import { randomUUID } from "node:crypto";
import { isDeepStrictEqual } from "node:util";

import { failures, runExternalStep, runInternalStep } from "@workspace/actions";
import type {
  ActionError,
  Actor,
  AnyActionDefinition,
  Clock,
  ConfigService,
  DeclaredError,
} from "@workspace/actions";
import {
  createIdentityStore,
  findRun,
  isUniqueViolation,
  lockRun,
  saveRunSteps,
  updateRun,
  updateRunStep,
} from "@workspace/db";
import type { Db, Tx } from "@workspace/db";
import type { z } from "zod";

import {
  attach,
  durableSleep,
  durableStep,
  launch,
  startDurable,
} from "./durable.ts";
import type { DurableArgs } from "./durable.ts";
import { effectsOf } from "./effects.ts";
import { schemaOf } from "./fields.ts";
import type { FieldSpecs } from "./fields.ts";
import { failureStepsFor, listOf } from "./paths.ts";
import type { ListRef, Path } from "./paths.ts";
import { operatorOf } from "./schema.ts";
import type { Condition, Source, Step, WorkflowDefinition } from "./schema.ts";
import { Trace } from "./trace.ts";
import type { RunStepRow as StepRow } from "./trace.ts";

export type RunError = ActionError | DeclaredError;

export type WorkflowResult =
  | {
      ok: true;
      runId: string;
      output: Record<string, unknown>;
      pending?: undefined;
    }
  | {
      /** It paused, or is still going: `GET /runs/{id}` follows it (P2.20). */
      ok: true;
      runId: string;
      pending: true;
      status: "running" | "waiting";
      output?: undefined;
    }
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
  /** The run that emitted the event, or ran this one. */
  readonly parentRunId?: string | null;
  readonly depth?: number;
  /** The minute a schedule started it for. */
  readonly scheduledFor?: Date;
}

/** What a run reads besides its definition, which a restart takes afresh. */
export type RunContext = Pick<
  WorkflowRunOptions,
  "config" | "workflows" | "events"
>;

export interface DurableOptions {
  /** The system's name: a restarted server picks up its runs by it. */
  readonly name: string;
  /** Where DBOS keeps its checkpoints: the system's own database. */
  readonly databaseUrl: string;
  /** The config, workflows and events of a run a restart picked up. */
  readonly context: () => RunContext;
  /** How an external step that fails with `unavailable` is tried again. */
  readonly retries?: {
    readonly attempts: number;
    readonly firstDelayMs: number;
  };
  /** How long a caller waits for a run to finish or pause; 10s by default. */
  readonly waitMs?: number;
}

export interface RunnerOptions {
  readonly db: Db;
  /** The actions steps run, by name: `System.stepActions`. */
  readonly actions: ReadonlyMap<string, AnyActionDefinition>;
  readonly clock: Clock;
  /** Runs that pause or reach other systems need it (P2.20). */
  readonly durable?: DurableOptions;
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

const defaultRetries = { attempts: 5, firstDelayMs: 1000 };

/** Carries a run's error out of its transaction, rolling it back. */
class RunFailedError extends Error {
  readonly failure: RunError;
  /** Where in the top run's steps it failed. */
  readonly path: Path;
  constructor(failure: RunError, path: Path) {
    super(failure.message);
    this.name = "RunFailedError";
    this.failure = failure;
    this.path = path;
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

const durationUnits: Record<string, number> = {
  s: 1000,
  m: 60_000,
  h: 3_600_000,
  d: 86_400_000,
  w: 604_800_000,
};

/** `3d` in milliseconds. */
const msOf = (duration: string) =>
  Number(duration.slice(0, -1)) * (durationUnits[duration.slice(-1)] ?? 0);

/** The ids of steps whose output some value or condition in `workflow` reads. */
const readIn = (workflow: WorkflowDefinition): Set<string> => {
  const found = new Set<string>();
  const visit = (value: unknown) => {
    if (Array.isArray(value)) {
      for (const each of value) {
        visit(each);
      }
      return;
    }
    if (typeof value !== "object" || value === null) {
      return;
    }
    for (const [key, each] of Object.entries(value)) {
      if (
        (key === "from" || key === "field") &&
        typeof each === "string" &&
        each.startsWith("steps.")
      ) {
        found.add(each.split(".")[1] ?? "");
      } else if (key !== "value") {
        visit(each);
      }
    }
  };
  visit([workflow.steps, workflow.output, workflow.on_failure]);
  return found;
};

/** One run of one workflow: what it can read, and what it has done. */
interface Frame {
  readonly workflow: WorkflowDefinition;
  readonly runId: string;
  readonly actor: Actor;
  readonly depth: number;
  readonly input: Readonly<Record<string, unknown>>;
  /** The event that started the run, for a top run an event started. */
  readonly event?: RunStart | null | undefined;
  /** Each step's output, by id. */
  readonly outputs: Map<string, unknown>;
  /** For a child run: its `run` step's path in the top run. */
  readonly anchor: Path | null;
}

/** The option `value` names in the choice list `list`, as config has it. */
const optionOf = (config: ConfigService, list: string, value: unknown) =>
  config.choices?.(list)?.find((each) => each.key === value);

/** What `path` reads; a choice's column comes from the pinned config. */
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
  config: ConfigService,
  path: Path
): Record<string, unknown> => {
  const parsed = schemaOf(workflow.input).safeParse(input);
  if (!parsed.success) {
    throw new RunFailedError(failures.invalidInput(parsed.error).error, path);
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
        ).error,
        path
      );
    }
  }
  return parsed.data;
};

/** The depth limit, checked as each run starts. */
const checkDepth = (key: string, depth: number, path: Path) => {
  if (depth > maxDepth) {
    throw new RunFailedError(
      failures.conflict(
        `${key} is ${depth} runs deep, past the limit of ${maxDepth}: workflows may be running each other in a loop.`
      ).error,
      path
    );
  }
};

/** An external step whose output nothing reads, sent once its segment commits. */
interface Queued {
  readonly runId: string;
  readonly workflow: string;
  readonly stepId: string;
  readonly action: string;
  readonly input: Record<string, unknown>;
  /** Where it is in the top run, for its `on_failure`. */
  readonly path: Path;
}

/** Where a segment stopped, to pause outside any transaction. */
type Cut =
  | {
      readonly kind: "wait";
      readonly path: Path;
      readonly rowId: string;
      readonly until: string;
    }
  | {
      readonly kind: "external";
      readonly path: Path;
      readonly stepId: string;
      readonly action: string;
      readonly input: Record<string, unknown>;
    }
  | {
      readonly kind: "child";
      readonly path: Path;
      readonly stepId: string;
      readonly rowId: string;
      readonly workflow: string;
      readonly input: Record<string, unknown>;
    };

/** Where a durable run has got to, between segments. */
interface Phase {
  readonly list: ListRef;
  /** Go on after this step of `list`; null: from its start. */
  readonly resume: Path | null;
  /** Sends the last segment queued, still to make. */
  readonly queued: readonly Queued[];
  /** The pause to make before the next segment. */
  readonly pending: Cut | null;
  /** Its steps are done, with this output. */
  readonly finished: Record<string, unknown> | null;
  /** The run's row already says how it ended. */
  readonly closed: boolean;
}

/** A failure after a commit: what a retry goes back to. */
interface Failed {
  readonly error: RunError;
  readonly path: Path;
  readonly phase: Phase;
  readonly outputs: Record<string, unknown>;
}

/** A durable run's checkpoint, on its `runs` row. */
interface Checkpoint {
  /** The last segment committed. */
  readonly segment: number;
  readonly definition: WorkflowDefinition;
  readonly input: Record<string, unknown>;
  readonly start: RunStart | null;
  readonly outputs: Record<string, unknown>;
  readonly depth: number;
  /** Some committed segment or send changed something. */
  readonly wrote: boolean;
  readonly phase: Phase;
  readonly failed: Failed | null;
}

type SegmentResult =
  | { readonly kind: "committed"; readonly checkpoint: Checkpoint }
  | { readonly kind: "failed"; readonly error: RunError; readonly path: Path }
  | { readonly kind: "duplicate"; readonly error: RunError };

/** What every frame of one segment shares. */
interface Shared {
  readonly tx: Tx;
  readonly trace: Trace;
  readonly options: WorkflowRunOptions;
  readonly segment: number;
  /** Null when the run can't pause or reach another system. */
  readonly queued: Queued[] | null;
  wrote: boolean;
}

type Ended =
  | { readonly output: Record<string, unknown> }
  | { readonly cut: Cut }
  | null;

/** A pause's step that the next segment closes. */
interface Closing {
  readonly rowId: string;
  readonly output?: unknown;
}

const fromStart = (list: ListRef): Phase => ({
  list,
  resume: null,
  queued: [],
  pending: null,
  finished: null,
  closed: false,
});

/** Who acts on a run that needs attention. */
export interface Attending {
  readonly userId: string;
  /** Whether they hold the role `key`. */
  readonly holds: (key: string) => boolean;
}

export type AttendResult =
  | WorkflowResult
  | { ok: true; runId: string; resolved: true; pending?: undefined };

/**
 * A runner over a system's step actions. It finds each workflow's actor
 * once, then runs workflows with `run`.
 */
export const createRunner = ({
  db,
  actions,
  clock,
  durable,
}: RunnerOptions) => {
  const actorIds = new Map<string, Actor>();
  const identity = createIdentityStore(db);
  const retries = durable?.retries ?? defaultRetries;
  const reads = new WeakMap<WorkflowDefinition, Set<string>>();
  /** Options of runs started in this process, which a restart loses. */
  const live = new Map<string, WorkflowRunOptions>();
  /** Callers waiting for a run to pause. */
  const waiters = new Map<string, (status: "running" | "waiting") => void>();
  let detach: (() => Promise<void>) | null = null;

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

  const isRead = (workflow: WorkflowDefinition, stepId: string) => {
    let found = reads.get(workflow);
    if (!found) {
      found = readIn(workflow);
      reads.set(workflow, found);
    }
    return found.has(stepId);
  };

  const stepRow = (
    segment: number,
    runId: string,
    stepId: string,
    kind: "action" | "control",
    name: string,
    input: unknown
  ): StepRow => ({
    id: randomUUID(),
    runId,
    stepId,
    kind,
    name,
    input: input ?? null,
    segment,
    startedAt: clock.now(),
  });

  /** A step row of `frame`'s run in this segment. */
  const rowOf = (
    shared: Shared,
    frame: Frame,
    stepId: string,
    kind: "action" | "control",
    name: string,
    input: unknown
  ) => stepRow(shared.segment, frame.runId, stepId, kind, name, input);

  /** Fails the run with `error`, recorded on the step `row`. */
  const failStep = (
    shared: Shared,
    row: StepRow,
    error: RunError,
    path: Path
  ): never => {
    shared.trace.endStep(row.id, { error, finishedAt: clock.now() });
    throw new RunFailedError(error, path);
  };

  const actionStep = async (
    shared: Shared,
    step: Extract<Step, { action: string }>,
    frame: Frame,
    path: Path
  ): Promise<Ended> => {
    const action = actions.get(step.action);
    if (!action) {
      throw new Error(`There is no action "${step.action}".`);
    }
    const { tx, trace, options } = shared;
    const input = given(step.with, frame, options.config);
    if (action.kind === "external") {
      if (!shared.queued) {
        throw new Error(
          `${frame.workflow.key} runs the external action ${action.name} in a run that can't reach other systems.`
        );
      }
      if (frame.anchor === null && isRead(frame.workflow, step.id)) {
        // A later step reads its output: commit, run it, go on with it.
        return {
          cut: {
            kind: "external",
            path,
            stepId: step.id,
            action: action.name,
            input,
          },
        };
      }
      shared.queued.push({
        runId: frame.runId,
        workflow: frame.workflow.key,
        stepId: step.id,
        action: action.name,
        input,
        path: frame.anchor ?? path,
      });
      return null;
    }
    const row = rowOf(shared, frame, step.id, "action", action.name, input);
    await trace.startStep(tx, row);
    const result = await runInternalStep(tx, action, input, {
      place: { runId: frame.runId, stepId: step.id, rowId: row.id },
      actor: frame.actor,
      originUserId: options.originUserId,
      config: options.config,
      clock,
    });
    if (!result.ok) {
      return failStep(shared, row, result.error, frame.anchor ?? path);
    }
    shared.wrote ||= !action.readOnly;
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
    return null;
  };

  const emitStep = (
    shared: Shared,
    step: Extract<Step, { emit: string }>,
    frame: Frame,
    path: Path
  ) => {
    const { trace, options } = shared;
    const payload = given(step.with, frame, options.config);
    const row = rowOf(shared, frame, step.id, "control", "emit", payload);
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
        ).error,
        frame.anchor ?? path
      );
    }
    shared.wrote = true;
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
    frame: Frame,
    path: Path
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
      ...rowOf(shared, frame, step.id, "control", "if", seen),
      branch: taken,
      finishedAt: clock.now(),
    });
    const branch = taken === "then" ? step.then : (step.else ?? []);
    // oxlint-disable-next-line eslint/no-use-before-define -- recursive
    return walk(shared, branch, frame, {
      path: [...path, taken],
      where: `${step.id}.${taken}`,
    });
  };

  const waitStep = (
    shared: Shared,
    step: Extract<Step, { wait: unknown }>,
    frame: Frame,
    path: Path
  ): Ended => {
    if (!shared.queued || frame.anchor !== null) {
      throw new Error(`${frame.workflow.key} waits in a run that can't.`);
    }
    const until =
      "for" in step.wait
        ? new Date(clock.now().getTime() + msOf(step.wait.for))
        : new Date(String(valueOf(step.wait.until, frame, shared.options.config)));
    const valid = !Number.isNaN(until.getTime());
    const row = rowOf(shared, frame, step.id, "control", "wait", {
      until: valid ? until.toISOString() : null,
    });
    shared.trace.addStep(row);
    if (!valid) {
      return failStep(
        shared,
        row,
        failures.invalid(`${step.id} has no date to wait until.`).error,
        path
      );
    }
    return {
      cut: { kind: "wait", path, rowId: row.id, until: until.toISOString() },
    };
  };

  const runStep = async (
    shared: Shared,
    step: Extract<Step, { run: string }>,
    frame: Frame,
    path: Path
  ): Promise<Ended> => {
    const { trace, options } = shared;
    const child = options.workflows?.get(step.run);
    if (!child) {
      throw new Error(`There is no workflow "${step.run}".`);
    }
    const input = given(step.with, frame, options.config);
    const row = rowOf(shared, frame, step.id, "control", "run", input);
    // The child run points at its parent run, not at this step.
    trace.addStep(row);
    if (effectsOf(child, actions, options.workflows).pauses) {
      if (!shared.queued || frame.anchor !== null) {
        throw new Error(
          `${frame.workflow.key} runs ${child.key}, which may pause, in a run that can't.`
        );
      }
      // It runs as a durable run of its own; this one waits for it.
      return {
        cut: {
          kind: "child",
          path,
          stepId: step.id,
          rowId: row.id,
          workflow: child.key,
          input,
        },
      };
    }
    try {
      // oxlint-disable-next-line eslint/no-use-before-define -- recursive
      const output = await execute(shared, child, input, {
        parentRunId: frame.runId,
        depth: frame.depth + 1,
        anchor: frame.anchor ?? path,
      });
      frame.outputs.set(step.id, output);
      trace.endStep(row.id, { output, finishedAt: clock.now() });
      return null;
    } catch (error) {
      if (error instanceof RunFailedError) {
        failStep(shared, row, error.failure, frame.anchor ?? path);
      }
      throw error;
    }
  };

  /** Runs one step; what it ends the segment with, if it does. */
  const one = async (
    shared: Shared,
    step: Step,
    frame: Frame,
    path: Path,
    where: string
  ): Promise<Ended> => {
    if ("action" in step) {
      return actionStep(shared, step, frame, path);
    }
    if ("if" in step) {
      return ifStep(shared, step, frame, path);
    }
    if ("run" in step) {
      return runStep(shared, step, frame, path);
    }
    if ("emit" in step) {
      emitStep(shared, step, frame, path);
      return null;
    }
    if ("wait" in step) {
      return waitStep(shared, step, frame, path);
    }
    if ("fail" in step) {
      const message =
        step.message ?? frame.workflow.errors?.[step.fail] ?? step.fail;
      const row = rowOf(shared, frame, step.id ?? where, "control", "fail", null);
      shared.trace.addStep(row);
      return failStep(
        shared,
        row,
        { code: step.fail, message, declared: true },
        frame.anchor ?? path
      );
    }
    if ("output" in step) {
      const output = given(step.output, frame, shared.options.config);
      const row = rowOf(
        shared,
        frame,
        step.id ?? where,
        "control",
        "output",
        null
      );
      shared.trace.addStep({ ...row, output, finishedAt: clock.now() });
      return { output };
    }
    throw new Error(
      `${frame.workflow.key} waits for approval at ${step.id}; approval steps come with P2.21.`
    );
  };

  /**
   * Runs `steps` in order from the start, or from the step after `resume`
   * (a path below them); what ends the segment, if one does.
   */
  const walk = async (
    shared: Shared,
    steps: readonly Step[],
    frame: Frame,
    at: { path: Path; where: string },
    resume: Path | null = null
  ): Promise<Ended> => {
    let first = 0;
    if (resume !== null) {
      const [index = 0, branch, ...inner] = resume;
      first = Number(index) + 1;
      const step = steps[Number(index)];
      if (branch !== undefined && step && "if" in step) {
        // It paused inside this branch: finish the branch first.
        const ended = await walk(
          shared,
          branch === "then" ? step.then : (step.else ?? []),
          frame,
          {
            path: [...at.path, Number(index), branch],
            where: `${step.id}.${String(branch)}`,
          },
          inner
        );
        if (ended) {
          return ended;
        }
      }
    }
    for (const [index, step] of steps.entries()) {
      if (index < first) {
        continue;
      }
      // Steps run one after another: each may read what the last did.
      // oxlint-disable-next-line eslint/no-await-in-loop
      const ended = await one(
        shared,
        step,
        frame,
        [...at.path, index],
        `${at.where}.${index}`
      );
      if (ended) {
        return ended;
      }
    }
    return null;
  };

  /** Runs `workflow` as a child run of its own in the shared transaction. */
  const execute = async (
    shared: Shared,
    workflow: WorkflowDefinition,
    input: unknown,
    place: { parentRunId: string; depth: number; anchor: Path }
  ): Promise<Record<string, unknown>> => {
    const { tx, trace, options } = shared;
    const actor = await actorOf(workflow.key);
    const runId = randomUUID();
    await trace.startRun(tx, {
      id: runId,
      endpoint: workflow.key,
      actorId: actor.id,
      originUserId: options.originUserId,
      input: input ?? {},
      status: "running",
      configSha: options.config.sha,
      parentRunId: place.parentRunId,
      depth: place.depth,
      startedAt: clock.now(),
    });
    checkDepth(workflow.key, place.depth, place.anchor);
    const frame: Frame = {
      workflow,
      runId,
      actor,
      depth: place.depth,
      input: parseInput(workflow, input, options.config, place.anchor),
      outputs: new Map(),
      anchor: place.anchor,
    };
    const ended = await walk(shared, workflow.steps, frame, {
      path: [],
      where: "steps",
    });
    if (ended && "cut" in ended) {
      throw new Error(`${workflow.key} paused inside a run that can't.`);
    }
    const output =
      ended?.output ?? given(workflow.output, frame, options.config);
    trace.endRun(runId, {
      status: "succeeded",
      output,
      finishedAt: clock.now(),
    });
    return output;
  };

  /** The top run's frame for a segment: new, or from its checkpoint. */
  const frameFor = async (
    shared: Shared,
    place: SegmentPlace,
    actor: Actor
  ): Promise<Frame> => {
    const { runId, workflow, options, from } = place;
    if (from) {
      for (const each of place.closing ?? []) {
        // oxlint-disable-next-line eslint/no-await-in-loop -- one pause
        await updateRunStep(shared.tx, each.rowId, {
          output: each.output ?? null,
          finishedAt: clock.now(),
        });
      }
      return {
        workflow,
        runId,
        actor,
        depth: from.depth,
        input: from.input,
        event: from.start,
        outputs: new Map(Object.entries(from.outputs)),
        anchor: null,
      };
    }
    const start = options.start ?? {};
    const depth = start.depth ?? 0;
    await shared.trace.startRun(shared.tx, {
      id: runId,
      endpoint: workflow.key,
      actorId: actor.id,
      originUserId: options.originUserId,
      input: place.input ?? {},
      status: "running",
      configSha: options.config.sha,
      retryKey: options.retryKey ?? null,
      eventId: start.event?.id ?? null,
      scheduledFor: start.scheduledFor ?? null,
      parentRunId: start.parentRunId ?? null,
      depth,
      startedAt: clock.now(),
    });
    checkDepth(workflow.key, depth, []);
    return {
      workflow,
      runId,
      actor,
      depth,
      input: parseInput(workflow, place.input, options.config, []),
      event: start,
      outputs: new Map(),
      anchor: null,
    };
  };

  interface SegmentPlace {
    readonly runId: string;
    readonly workflow: WorkflowDefinition;
    readonly input: unknown;
    readonly options: WorkflowRunOptions;
    /** Null for the run's first segment. */
    readonly from: Checkpoint | null;
    readonly durable: boolean;
    /** Steps the last pause left open. */
    readonly closing?: readonly Closing[];
  }

  /** How the top run's row ends a segment, with its checkpoint. */
  const rowAfter = (checkpoint: Checkpoint, cut: Cut | null) => {
    const { phase } = checkpoint;
    if (!phase.closed) {
      return { status: cut?.kind === "wait" ? "waiting" : "running" } as const;
    }
    return phase.list === "steps"
      ? ({
          status: "succeeded",
          output: phase.finished,
          finishedAt: clock.now(),
        } as const)
      : ({
          status: "failed",
          error: checkpoint.failed?.error ?? null,
          finishedAt: clock.now(),
        } as const);
  };

  /**
   * One segment of the top run, in one transaction: from the start, or from
   * a checkpoint. A durable run's segment saves its checkpoint as it
   * commits, and one that already committed hands that back instead of
   * running again.
   */
  const segment = async (place: SegmentPlace): Promise<SegmentResult> => {
    const { runId, workflow, options, from } = place;
    const n = from ? from.segment + 1 : 0;
    const trace = new Trace();
    const actor = await actorOf(workflow.key);
    try {
      return await db.transaction(async (tx): Promise<SegmentResult> => {
        if (place.durable) {
          const row = await lockRun(tx, runId);
          const done = row?.checkpoint as Checkpoint | null | undefined;
          if (done && done.segment >= n) {
            return { kind: "committed", checkpoint: done };
          }
        }
        const shared: Shared = {
          tx,
          trace,
          options,
          segment: n,
          queued: place.durable ? [] : null,
          wrote: false,
        };
        const frame = await frameFor(shared, place, actor);
        const phase = from?.phase ?? fromStart("steps");
        const recovering = phase.list !== "steps";
        const ended = await walk(
          shared,
          listOf(workflow, phase.list),
          frame,
          { path: [], where: recovering ? "on_failure" : "steps" },
          phase.resume
        );
        const cut = ended && "cut" in ended ? ended.cut : null;
        const output =
          cut || recovering
            ? {}
            : ((ended && "output" in ended ? ended.output : null) ??
              given(workflow.output, frame, options.config));
        const queued = shared.queued ?? [];
        const checkpoint: Checkpoint = {
          segment: n,
          definition: workflow,
          input: frame.input,
          start: frame.event ?? null,
          outputs: Object.fromEntries(frame.outputs),
          depth: frame.depth,
          wrote: (from?.wrote ?? false) || shared.wrote,
          phase: {
            list: phase.list,
            resume: cut?.path ?? null,
            queued,
            pending: cut,
            finished: cut ? null : output,
            // Done, with nothing left to send: the run ends here.
            closed: !cut && queued.length === 0,
          },
          failed: from?.failed ?? null,
        };
        if (!place.durable) {
          trace.endRun(runId, {
            status: "succeeded",
            output,
            finishedAt: clock.now(),
          });
        }
        await trace.finish(tx);
        if (place.durable) {
          await updateRun(tx, runId, {
            checkpoint,
            ...rowAfter(checkpoint, cut),
          });
        }
        return { kind: "committed", checkpoint };
      });
    } catch (error) {
      if (
        isUniqueViolation(error, "runs_event_unique") ||
        isUniqueViolation(error, "runs_schedule_unique")
      ) {
        // Another dispatcher started it first; this one never ran.
        return {
          kind: "duplicate",
          error: failures.conflict(
            `${workflow.key} has already run for this ${options.start?.event ? "event" : "minute"}`
          ).error,
        };
      }
      const failure =
        error instanceof RunFailedError
          ? error.failure
          : { code: "internal", message: String(error) };
      await trace.rewrite(db, failure, clock.now());
      if (n > 0) {
        // Only this segment was undone: the trace says so.
        await saveRunSteps(db, [
          {
            ...stepRow(n, runId, "rolled_back", "control", "rolled_back", {
              segment: n,
            }),
            error: failure,
            finishedAt: clock.now(),
          },
        ]);
      }
      if (error instanceof RunFailedError) {
        return { kind: "failed", error: error.failure, path: error.path };
      }
      throw error;
    }
  };

  type Sent =
    | { readonly ok: true; readonly output: unknown }
    | { readonly ok: false; readonly error: RunError };

  /** Runs the external action of `step` once, traced as an attempt. */
  const attempt = async (
    step: Pick<Queued, "runId" | "workflow" | "stepId" | "action" | "input">,
    number: number,
    options: WorkflowRunOptions,
    segmentNumber: number
  ): Promise<Sent> => {
    const action = actions.get(step.action);
    if (!action) {
      throw new Error(`There is no action "${step.action}".`);
    }
    const row = {
      ...stepRow(
        segmentNumber,
        step.runId,
        step.stepId,
        "action",
        action.name,
        step.input
      ),
      attempt: number,
    };
    await saveRunSteps(db, [row]);
    const result = await runExternalStep(action, step.input, {
      place: { runId: step.runId, stepId: step.stepId, rowId: row.id },
      actor: await actorOf(step.workflow),
      originUserId: options.originUserId,
      config: options.config,
      clock,
    }).catch(
      // Anything thrown reaching another system counts as temporary.
      (error: unknown) =>
        ({
          ok: false,
          error: failures.unavailable(String(error)).error,
        }) as const
    );
    await updateRunStep(db, row.id, {
      ...(result.ok
        ? { output: (result.output as object | null) ?? null }
        : { error: result.error }),
      finishedAt: clock.now(),
    });
    return result.ok
      ? { ok: true, output: result.output }
      : { ok: false, error: result.error };
  };

  /** Sends an external step, again with backoff while it is unavailable. */
  const send = async (
    step: Pick<Queued, "runId" | "workflow" | "stepId" | "action" | "input">,
    options: WorkflowRunOptions,
    segmentNumber: number
  ): Promise<Sent> => {
    for (let number = 1; ; number += 1) {
      // Each attempt is a checkpointed step: a restart doesn't repeat it.
      // oxlint-disable-next-line eslint/no-await-in-loop
      const result = await durableStep(`${step.stepId} #${number}`, () =>
        attempt(step, number, options, segmentNumber)
      );
      if (
        result.ok ||
        result.error.code !== "unavailable" ||
        number >= retries.attempts
      ) {
        return result;
      }
      // oxlint-disable-next-line eslint/no-await-in-loop
      await durableSleep(retries.firstDelayMs * 2 ** (number - 1));
    }
  };

  /** Brings a durable run's row up to date, as a checkpointed step. */
  const settle = (
    runId: string,
    name: string,
    change: Parameters<typeof updateRun>[2]
  ) =>
    durableStep(name, async () => {
      await updateRun(db, runId, change);
      return null;
    });

  /**
   * After a failure past a commit: the checkpoint to go on from with the
   * failure steps, or how the run ended. `error` failed at `path`.
   */
  const afterFailure = async (
    runId: string,
    state: Checkpoint,
    error: RunError,
    path: Path
  ): Promise<Checkpoint | WorkflowResult> => {
    const recovering = state.phase.list !== "steps";
    const failed: Failed =
      recovering && state.failed
        ? state.failed
        : { error, path, phase: state.phase, outputs: state.outputs };
    const way = recovering ? null : failureStepsFor(state.definition, path);
    if (way && way.onFailure !== "leave") {
      return {
        ...state,
        failed,
        phase: fromStart({ on_failure: way.owner }),
      };
    }
    const kept: Checkpoint = { ...state, failed };
    // Kept on purpose, or nothing to undo: it failed. Otherwise someone
    // has to look at it.
    const attention =
      recovering || (way === null && state.wrote)
        ? {
            status: "needs_attention" as const,
            attentionRole: state.definition.attention_role ?? null,
          }
        : { status: "failed" as const };
    await settle(runId, attention.status, {
      ...attention,
      error,
      checkpoint: kept,
      finishedAt: clock.now(),
    });
    return { ok: false, runId, error };
  };

  /** Makes the pause `cut`: what came of it, and the step it leaves open. */
  const pause = async (
    runId: string,
    state: Checkpoint,
    cut: Cut,
    options: WorkflowRunOptions
  ): Promise<
    | { readonly ok: true; readonly output: unknown; readonly closing: Closing[] }
    | { readonly ok: false; readonly error: RunError }
  > => {
    if (cut.kind === "wait") {
      waiters.get(runId)?.("waiting");
      await durableSleep(new Date(cut.until).getTime() - clock.now().getTime());
      return { ok: true, output: null, closing: [{ rowId: cut.rowId }] };
    }
    if (cut.kind === "external") {
      const sent = await send(
        { ...cut, runId, workflow: state.definition.key },
        options,
        state.segment
      );
      return sent.ok ? { ...sent, closing: [] } : sent;
    }
    waiters.get(runId)?.("running");
    const child = options.workflows?.get(cut.workflow);
    if (!child) {
      throw new Error(`There is no workflow "${cut.workflow}".`);
    }
    const childId = await durableStep(`${cut.stepId} run`, () =>
      Promise.resolve(randomUUID())
    );
    const start = { parentRunId: runId, depth: state.depth + 1 };
    live.set(childId, { ...options, start });
    const handle = await startDurable(childId, {
      host: durable?.name ?? "",
      runId: childId,
      begin: {
        definition: child,
        input: cut.input,
        originUserId: options.originUserId,
        start,
      },
    });
    const result = (await handle.getResult()) as WorkflowResult;
    live.delete(childId);
    if (!result.ok) {
      return { ok: false, error: result.error };
    }
    const output = result.output ?? {};
    return { ok: true, output, closing: [{ rowId: cut.rowId, output }] };
  };

  /** How a durable run ends once its steps are done. */
  const finish = async (
    runId: string,
    state: Checkpoint
  ): Promise<WorkflowResult> => {
    const { phase } = state;
    const recovered = phase.list !== "steps";
    const error = state.failed?.error;
    if (!phase.closed) {
      await settle(
        runId,
        "finish",
        recovered
          ? { status: "failed", error, finishedAt: clock.now() }
          : {
              status: "succeeded",
              output: phase.finished,
              finishedAt: clock.now(),
            }
      );
    }
    return recovered && error
      ? { ok: false, runId, error }
      : { ok: true, runId, output: phase.finished ?? {} };
  };

  /**
   * What happens next between segments: a send, a pause, the end, or (as
   * `null`) the next segment. A checkpoint is where it goes on from.
   */
  const between = async (
    runId: string,
    state: Checkpoint,
    options: WorkflowRunOptions
  ): Promise<
    | { readonly next: Checkpoint; readonly closing?: Closing[] }
    | { readonly ended: WorkflowResult }
    | null
  > => {
    const { phase } = state;
    const [queued, ...rest] = phase.queued;
    if (queued) {
      const sent = await send(queued, options, state.segment);
      if (!sent.ok) {
        const after = await afterFailure(runId, state, sent.error, queued.path);
        return "segment" in after ? { next: after } : { ended: after };
      }
      return {
        next: { ...state, wrote: true, phase: { ...phase, queued: rest } },
      };
    }
    const cut = phase.pending;
    if (cut) {
      const outcome = await pause(runId, state, cut, options);
      if (!outcome.ok) {
        const after = await afterFailure(runId, state, outcome.error, cut.path);
        return "segment" in after ? { next: after } : { ended: after };
      }
      return {
        next: {
          ...state,
          wrote: state.wrote || cut.kind !== "wait",
          outputs:
            cut.kind === "wait"
              ? state.outputs
              : { ...state.outputs, [cut.stepId]: outcome.output },
          phase: { ...phase, pending: null },
        },
        closing: outcome.closing,
      };
    }
    return phase.finished ? { ended: await finish(runId, state) } : null;
  };

  /**
   * A durable run, as its DBOS workflow: segments, and between them the
   * sends, waits, external steps and child runs, each checkpointed, so a
   * restart replays what finished and carries on.
   */
  const drive = async (args: DurableArgs): Promise<WorkflowResult> => {
    const { runId, begin } = args;
    let state: Checkpoint | null = null;
    let origin = begin?.originUserId ?? null;
    if (!begin) {
      const row = await durableStep("load", () => findRun(db, runId));
      state = (row?.checkpoint as Checkpoint | null | undefined) ?? null;
      origin = row?.originUserId ?? null;
      if (!state) {
        throw new Error(`Run ${runId} has no checkpoint to go on from.`);
      }
    }
    // Started here, it has its caller's options; picked up after a
    // restart, it reads the config as it is now.
    const options: WorkflowRunOptions = live.get(runId) ?? {
      ...contextNow(),
      originUserId: origin,
      ...(begin?.retryKey === undefined ? {} : { retryKey: begin.retryKey }),
      ...(begin?.start ? { start: begin.start } : {}),
    };
    const workflow = state?.definition ?? begin?.definition;
    if (!workflow) {
      throw new Error(`Run ${runId} has no definition.`);
    }
    let closing: readonly Closing[] = [];
    for (;;) {
      if (state) {
        // oxlint-disable-next-line eslint/no-await-in-loop -- one at a time
        const step = await between(runId, state, options);
        if (step && "ended" in step) {
          return step.ended;
        }
        if (step) {
          state = step.next;
          closing = step.closing ?? closing;
          continue;
        }
      }
      const from = state;
      const toClose = closing;
      closing = [];
      // oxlint-disable-next-line eslint/no-await-in-loop -- one at a time
      const result = await durableStep(
        `segment ${from ? from.segment + 1 : 0}`,
        () =>
          segment({
            runId,
            workflow,
            input: begin?.input,
            options,
            from,
            durable: true,
            closing: toClose,
          })
      );
      if (result.kind === "duplicate") {
        return { ok: false, runId, error: result.error, duplicate: true };
      }
      if (result.kind === "committed") {
        state = result.checkpoint;
        continue;
      }
      if (!from) {
        // Nothing was committed: the whole run rolled back.
        return { ok: false, runId, error: result.error };
      }
      // oxlint-disable-next-line eslint/no-await-in-loop
      const after = await afterFailure(runId, from, result.error, result.path);
      if (!("segment" in after)) {
        return after;
      }
      state = after;
    }
  };

  const needDurable = () => {
    if (!durable) {
      throw new Error("This runner has no durable options.");
    }
    return durable;
  };

  const contextNow = () => needDurable().context();

  /** Launches DBOS for this runner, which recovers the runs a stop left. */
  const start = async () => {
    const { name, databaseUrl } = needDurable();
    detach ??= attach(name, (args) => drive(args));
    await launch(databaseUrl);
  };

  /** Stops driving runs here; the last runner to stop shuts DBOS down. */
  const stop = async () => {
    const leaving = detach;
    detach = null;
    await leaving?.();
  };

  /**
   * Starts the DBOS workflow `id` for the run, then waits until the run
   * finishes, pauses, or `waitMs` passes.
   */
  const follow = async (
    id: string,
    args: DurableArgs
  ): Promise<WorkflowResult> => {
    await start();
    const { runId } = args;
    const paused = new Promise<"running" | "waiting">((resolve) => {
      waiters.set(runId, resolve);
    });
    const handle = await startDurable(id, args);
    const finished = (handle.getResult() as Promise<WorkflowResult>).finally(
      () => {
        live.delete(runId);
      }
    );
    // A stop while it waits rejects this; the next start picks the run up.
    finished.catch(() => undefined);
    let timer: NodeJS.Timeout | undefined;
    const timeout = new Promise<"running">((resolve) => {
      timer = setTimeout(() => resolve("running"), durable?.waitMs ?? 10_000);
    });
    try {
      const first = await Promise.race([finished, paused, timeout]);
      return typeof first === "string"
        ? { ok: true, runId, pending: true, status: first }
        : first;
    } finally {
      clearTimeout(timer);
      waiters.delete(runId);
    }
  };

  /**
   * Runs `workflow` with `input`. One that can't pause or reach another
   * system runs in one transaction: its output, or the typed error that
   * rolled it back. One that can runs durably: its output, its error, or
   * that it is still going. Either way the run is traced.
   */
  const run = async (
    workflow: WorkflowDefinition,
    input: unknown,
    options: WorkflowRunOptions
  ): Promise<WorkflowResult> => {
    const runId = randomUUID();
    const effects = effectsOf(workflow, actions, options.workflows);
    if (effects.external || effects.pauses) {
      if (!durable) {
        throw new Error(
          `${workflow.key} may pause or reach another system, so it needs a runner with durable options.`
        );
      }
      live.set(runId, options);
      return follow(runId, {
        host: durable.name,
        runId,
        begin: {
          definition: workflow,
          input,
          originUserId: options.originUserId,
          retryKey: options.retryKey,
          start: options.start,
        },
      });
    }
    const result = await segment({
      runId,
      workflow,
      input,
      options,
      from: null,
      durable: false,
    });
    if (result.kind === "committed") {
      return {
        ok: true,
        runId,
        output: result.checkpoint.phase.finished ?? {},
      };
    }
    return result.kind === "duplicate"
      ? { ok: false, runId, error: result.error, duplicate: true }
      : { ok: false, runId, error: result.error };
  };

  /**
   * Acts on the run `runId`, which needs attention: `retry` goes back to the
   * step that failed, `run_failure_steps` runs the steps that undo it, and
   * `resolve` marks it dealt with. Only someone holding the run's attention
   * role may (an admin when it names none), and each is a step in its trace.
   */
  const attend = async (
    runId: string,
    what: "retry" | "run_failure_steps" | "resolve",
    by: Attending,
    context: RunContext
  ): Promise<AttendResult> => {
    const outcome = await db.transaction(
      async (tx): Promise<RunError | { origin: string | null } | null> => {
        const row = await lockRun(tx, runId);
        if (!row) {
          return failures.notFound("run", runId).error;
        }
        if (row.status !== "needs_attention") {
          return failures.conflict(
            `This run is ${row.status.replaceAll("_", " ")}, so it doesn't need attention.`
          ).error;
        }
        const role = row.attentionRole ?? "admin";
        if (!by.holds(role)) {
          return failures.forbidden(
            role,
            `Only someone with the ${role} role can act on this run.`
          ).error;
        }
        const state = row.checkpoint as Checkpoint | null;
        const failed = state?.failed;
        if (!(state && failed)) {
          return failures.conflict("This run has no failure to go back to.")
            .error;
        }
        const way = failureStepsFor(state.definition, failed.path);
        if (
          what === "run_failure_steps" &&
          !(way && Array.isArray(way.onFailure))
        ) {
          return failures.conflict(
            "Nothing in this workflow undoes the step that failed."
          ).error;
        }
        await saveRunSteps(tx, [
          {
            ...stepRow(state.segment, runId, what, "control", what, {
              by: by.userId,
            }),
            finishedAt: clock.now(),
          },
        ]);
        if (what === "resolve") {
          await updateRun(tx, runId, { status: "resolved" });
          return null;
        }
        const next: Checkpoint =
          what === "retry"
            ? { ...state, phase: failed.phase, outputs: failed.outputs }
            : {
                ...state,
                phase: fromStart({ on_failure: way?.owner ?? null }),
              };
        await updateRun(tx, runId, {
          status: "running",
          checkpoint: next,
          finishedAt: null,
        });
        return { origin: row.originUserId };
      }
    );
    if (outcome === null) {
      return { ok: true, runId, resolved: true };
    }
    if ("code" in outcome) {
      return { ok: false, runId, error: outcome };
    }
    live.set(runId, { ...context, originUserId: outcome.origin });
    return follow(`${runId}:${what}:${randomUUID()}`, {
      host: durable?.name ?? "",
      runId,
    });
  };

  return { run, actorOf, attend, start, stop };
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
