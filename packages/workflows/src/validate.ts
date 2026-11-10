// validateWorkflow (P2.16, decision 0048): the publish gate's first step
// (decision 0045). It checks that a workflow lines up with the system:
// each action, workflow, event, field and choice it names exists, each
// step's input matches what it takes, each value comes from somewhere that
// has run by then, and each step that can fail after a commit has a way
// out. It also works out the segments: where a run may commit and go on
// later (decision 0046). Problems carry a path into the file, so config
// gives them a line.
import { actionErrorCodes } from "@workspace/actions";
import type { AnyActionDefinition } from "@workspace/actions";
import type { ConfigCatalog, ConfigPath } from "@workspace/config";
import { choiceOptionShape } from "@workspace/objects";
import { z } from "zod";

import { fieldOf, schemaOf } from "./fields.ts";
import type { FieldSpecs } from "./fields.ts";
import { operatorOf } from "./schema.ts";
import type {
  Condition,
  OnFailure,
  Source,
  Step,
  WorkflowDefinition,
} from "./schema.ts";
import {
  childOf,
  jsonOf,
  keysOf,
  mismatch,
  typeName,
  typeOf,
  expectedFor,
} from "./shapes.ts";
import type { Json } from "./shapes.ts";

export interface WorkflowProblem {
  readonly path: ConfigPath;
  readonly message: string;
}

/** Where a segment ends: the step that cuts it, and why. */
export interface SegmentEnd {
  readonly step: string;
  readonly why: string;
  /** It cuts only when the branch it is in runs. */
  readonly conditional: boolean;
}

/** Steps that commit together (decision 0046). */
export interface Segment {
  readonly steps: readonly string[];
  /** External steps whose output nothing uses: sent once it commits. */
  readonly queued: readonly string[];
  /** The step after which a new segment starts, or null for the last. */
  readonly ends: SegmentEnd | null;
}

export interface WorkflowCheck {
  /** What must be fixed before it can publish. */
  readonly problems: readonly WorkflowProblem[];
  /** What's allowed but worth a look, such as no ownership check. */
  readonly warnings: readonly WorkflowProblem[];
  readonly segments: readonly Segment[];
}

export interface WorkflowContext {
  readonly catalog: ConfigCatalog;
  /** The other workflows, by key, for `run` steps and their events. */
  readonly workflows?: ReadonlyMap<string, WorkflowDefinition>;
  /** Each choice list's option keys, from config, when they're known. */
  readonly choiceKeys?: ReadonlyMap<string, readonly string[]>;
}

const listed = (names: Iterable<string>) => {
  const all = [...names];
  return all.length > 0 ? all.join(", ") : "none";
};

const builtIn = new Set<string>([...actionErrorCodes, "internal"]);

/** The checks the core gives every system (P2.15). */
const ownershipCheck = "record_belongs_to_caller";

// ---------------------------------------------------------------------------
// Walking a definition

/** Every step, nested ones included, with its path. */
const eachStep = (
  steps: readonly Step[],
  path: ConfigPath
): [Step, ConfigPath][] =>
  steps.flatMap((step, index): [Step, ConfigPath][] => {
    const at = [...path, index];
    const onFailure = "on_failure" in step ? step.on_failure : undefined;
    return [
      [step, at],
      ...("if" in step
        ? [
            ...eachStep(step.then, [...at, "then"]),
            ...eachStep(step.else ?? [], [...at, "else"]),
          ]
        : []),
      ...(Array.isArray(onFailure)
        ? eachStep(onFailure as readonly Step[], [...at, "on_failure"])
        : []),
    ];
  });

/** Every step of a workflow, its `on_failure` steps included. */
export const allSteps = (workflow: WorkflowDefinition) => [
  ...eachStep(workflow.steps, ["steps"]),
  ...(Array.isArray(workflow.on_failure)
    ? eachStep(workflow.on_failure as readonly Step[], ["on_failure"])
    : []),
];

/** The ids of steps whose output some value or condition reads. */
export const readSteps = (workflow: WorkflowDefinition): Set<string> => {
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
  visit(workflow);
  return found;
};

const stepIdOf = (step: Step): string | undefined =>
  "id" in step ? step.id : undefined;

// ---------------------------------------------------------------------------
// What a workflow can see

/** Values a path can start from at one point in the steps. */
interface Scope {
  /** The input's fields, when the workflow is called. */
  readonly input: FieldSpecs | undefined;
  /** The event's fields or payload, when an event starts it. */
  readonly event: { specs?: FieldSpecs; node?: Json } | undefined;
  /** Steps that have run by here, with their output (null: none). */
  readonly ran: ReadonlyMap<string, Json | null>;
}

/** A path's value: its schema, and its choice list if it is a choice. */
type Resolved =
  | { ok: true; node: Json; list?: string | undefined }
  | { ok: false; message: string };

const failed = (message: string): Resolved => ({ ok: false, message });

// ---------------------------------------------------------------------------
// Flow: what has happened by a point in the steps

interface Flow {
  /** Steps that have run on every path to here, with their output. */
  ran: Map<string, Json | null>;
  /** A change may already be committed: a later failure can't undo it. */
  committedWrite: boolean;
  /** The current segment has written something. */
  wroteInSegment: boolean;
}

interface Mode {
  /** An `on_failure` around this step, or the workflow's, covers it. */
  covered: boolean;
  /** Inside a branch: a cut here happens only on that path. */
  conditional: boolean;
  /** In `on_failure` steps, which need no way out of their own. */
  recovering: boolean;
}

const newFlow = (ran: ReadonlyMap<string, Json | null>): Flow => ({
  ran: new Map(ran),
  committedWrite: false,
  wroteInSegment: false,
});

const branch = (flow: Flow): Flow => ({ ...flow, ran: new Map(flow.ran) });

interface Effect {
  writes: boolean;
  pauses: boolean;
}

const none: Effect = { writes: false, pauses: false };

/** What one step does, for `summarise`. */
const effectOf = (
  step: Step,
  read: ReadonlySet<string>,
  context: WorkflowContext,
  seen: Set<string>
): Effect => {
  if ("action" in step) {
    const action = context.catalog.stepActions?.get(step.action);
    return {
      writes: !action || action.kind === "external" || !action.readOnly,
      pauses: action?.kind === "external" && read.has(step.id),
    };
  }
  if ("emit" in step) {
    return { writes: true, pauses: false };
  }
  if ("wait" in step || "wait_for_approval" in step) {
    return { writes: false, pauses: true };
  }
  if (!("run" in step)) {
    return none;
  }
  const child =
    context.workflows?.get(step.run) ??
    (context.catalog.workflows?.get(step.run) as
      | WorkflowDefinition
      | undefined);
  if (!child) {
    return { writes: true, pauses: false };
  }
  // oxlint-disable-next-line eslint/no-use-before-define -- mutually recursive with summarise
  return summarise(child, context, seen);
};

/** Whether a workflow writes, and whether it may pause, for `run` steps. */
const summarise = (
  workflow: WorkflowDefinition,
  context: WorkflowContext,
  seen: Set<string>
): Effect => {
  if (seen.has(workflow.key)) {
    return none;
  }
  seen.add(workflow.key);
  const read = readSteps(workflow);
  const found = { ...none };
  for (const [step] of allSteps(workflow)) {
    const effect = effectOf(step, read, context, seen);
    found.writes ||= effect.writes;
    found.pauses ||= effect.pauses;
  }
  return found;
};

const below = (
  node: Json,
  keys: readonly string[],
  label: string
): Resolved => {
  let here = node;
  let at = label;
  for (const key of keys) {
    const next = childOf(here, key);
    if (!next) {
      const known = keysOf(here);
      return failed(
        known.length > 0
          ? `${at} has no "${key}". It has: ${listed(known)}.`
          : `${at} is ${typeName(typeOf(here))}, so it has no "${key}".`
      );
    }
    here = next;
    at = `${at}.${key}`;
  }
  return { ok: true, node: here };
};

export class WorkflowChecker {
  private readonly problems: WorkflowProblem[] = [];
  private readonly warnings: WorkflowProblem[] = [];
  private readonly segments: Segment[] = [];
  private current: { steps: string[]; queued: string[] } = {
    steps: [],
    queued: [],
  };
  private readonly read: Set<string>;
  private readonly ids = new Set<string>();

  private readonly workflow: WorkflowDefinition;
  private readonly context: WorkflowContext;

  constructor(workflow: WorkflowDefinition, context: WorkflowContext) {
    this.workflow = workflow;
    this.context = context;
    this.read = readSteps(workflow);
  }

  private problem(path: ConfigPath, message: string) {
    this.problems.push({ path, message });
  }

  // -- Names --------------------------------------------------------------

  private action(name: string): AnyActionDefinition | undefined {
    return this.context.catalog.stepActions?.get(name);
  }

  private other(key: string): WorkflowDefinition | undefined {
    const code = this.context.catalog.workflows?.get(key) as
      | WorkflowDefinition
      | undefined;
    return this.context.workflows?.get(key) ?? code;
  }

  /** An event's fields, when a workflow declares it, or its payload. */
  private eventShape(
    name: string
  ): { specs?: FieldSpecs; node?: Json } | undefined {
    const own = this.workflow.events?.[name];
    if (own) {
      return { specs: own };
    }
    for (const workflow of this.context.workflows?.values() ?? []) {
      const declared = workflow.events?.[name];
      if (declared) {
        return { specs: declared };
      }
    }
    const payload = this.context.catalog.eventPayloads?.get(name);
    if (payload) {
      return { node: jsonOf(payload, "output") };
    }
    return this.context.catalog.events.has(name) ? { node: {} } : undefined;
  }

  private choiceOption(list: string): z.ZodObject {
    const use = this.context.catalog.choiceLists.find(
      (each) => each.key === list
    );
    return use?.option ?? z.strictObject(choiceOptionShape);
  }

  private listExists(list: string) {
    return (
      this.context.catalog.choiceLists.some((each) => each.key === list) ||
      this.context.choiceKeys?.has(list) === true
    );
  }

  // -- Paths --------------------------------------------------------------

  /** A path into fields declared with field types. */
  private inFields(
    specs: FieldSpecs,
    keys: readonly string[],
    root: string
  ): Resolved {
    const [name = "", column, ...rest] = keys;
    const spec = specs[name];
    if (!spec) {
      return failed(
        `There is no ${root} "${name}". ${root === "input" ? "Inputs" : "Fields"}: ${listed(Object.keys(specs))}.`
      );
    }
    const label = `${root}.${name}`;
    if (spec.type === "choice") {
      if (column === undefined) {
        return { ok: true, node: { type: "string" }, list: spec.list };
      }
      const columns = this.choiceOption(spec.list).shape;
      const schema = columns[column];
      if (!schema) {
        return failed(
          `${label} is a choice from ${spec.list}, whose options have no "${column}". Columns: ${listed(Object.keys(columns))}.`
        );
      }
      return below(jsonOf(schema, "output"), rest, `${label}.${column}`);
    }
    return below(jsonOf(fieldOf(spec).input, "input"), keys.slice(1), label);
  }

  private resolve(path: string, scope: Scope): Resolved {
    const [root, ...keys] = path.split(".");
    if (root === "input") {
      return scope.input
        ? this.inFields(scope.input, keys, "input")
        : failed(
            "This workflow isn't called, so it has no input. A workflow an event starts reads event.…"
          );
    }
    if (root === "event") {
      if (!scope.event) {
        return failed("Only a workflow an event starts can read event.…");
      }
      return scope.event.specs
        ? this.inFields(scope.event.specs, keys, "event")
        : below(scope.event.node ?? {}, keys, "event");
    }
    const [id = "", output, ...rest] = keys;
    if (!this.ids.has(id)) {
      return failed(`There is no step "${id}".`);
    }
    if (output !== "output") {
      return failed(`Read a step's output as steps.${id}.output.…`);
    }
    if (!scope.ran.has(id)) {
      return failed(
        `Step "${id}" may not have run by here: it comes later, or in a branch that may not run.`
      );
    }
    const node = scope.ran.get(id);
    return node
      ? below(node, rest, `steps.${id}.output`)
      : failed(`Step "${id}" gives no output.`);
  }

  // -- Values and conditions ---------------------------------------------

  /** Checks `source` against `target`, the input it fills. */
  private source(
    source: Source,
    target: Json,
    path: ConfigPath,
    label: string,
    scope: Scope
  ) {
    if ("value" in source) {
      const expected = expectedFor(source.value, target);
      if (expected) {
        this.problem(
          [...path, "value"],
          `${label} takes ${expected}, not ${JSON.stringify(source.value)}.`
        );
      }
      return;
    }
    const found = this.resolve(source.from, scope);
    if (!found.ok) {
      this.problem([...path, "from"], found.message);
      return;
    }
    const wrong = mismatch(found.node, target);
    if (wrong) {
      this.problem(
        [...path, "from"],
        `${label} ${wrong}, but ${source.from} is ${typeName(typeOf(found.node))}.`
      );
    }
  }

  /** Checks a step's `with` against what `name` takes. */
  private with(
    given: Readonly<Record<string, Source>> | undefined,
    takes: Json,
    path: ConfigPath,
    name: string,
    scope: Scope,
    fixed: readonly string[] = []
  ) {
    const entries = Object.entries(given ?? {});
    const known = keysOf(takes);
    for (const [key, source] of entries) {
      const target = childOf(takes, key);
      const at = [...path, "with", key];
      if (!target || !known.includes(key)) {
        this.problem(
          at,
          `${name} takes no "${key}". It takes: ${listed(known)}.`
        );
      } else if (fixed.includes(key) && "from" in source) {
        this.problem(
          [...at, "from"],
          `${name}'s ${key} must be a fixed value in this file, never from data, so a record or event can't change where it goes.`
        );
      } else {
        this.source(source, target, at, `${name}'s ${key}`, scope);
      }
    }
    const required = (takes.required as string[] | undefined) ?? [];
    for (const key of required) {
      if (!given || !Object.hasOwn(given, key)) {
        this.problem(path, `${name} needs "${key}".`);
      }
    }
  }

  private condition(condition: Condition, path: ConfigPath, scope: Scope) {
    const found = this.resolve(condition.field, scope);
    if (!found.ok) {
      this.problem([...path, "field"], found.message);
      return;
    }
    const { operator, value } = operatorOf(condition);
    if (operator === "empty") {
      return;
    }
    const at = [...path, operator];
    if (["above", "at_least", "below", "at_most"].includes(operator)) {
      const type = typeOf(found.node);
      if (type !== "number" && type !== "anything") {
        this.problem(
          at,
          `${operator} compares numbers, but ${condition.field} is ${typeName(type)}.`
        );
      }
      return;
    }
    const values = Array.isArray(value) ? value : [value];
    const keys = found.list ? this.context.choiceKeys?.get(found.list) : null;
    for (const each of values) {
      const expected = expectedFor(each, found.node);
      if (expected) {
        this.problem(
          at,
          `${condition.field} holds ${expected}, so it is never ${JSON.stringify(each)}.`
        );
      } else if (keys && each !== null && !keys.includes(String(each))) {
        this.problem(
          at,
          `${found.list} has no option "${String(each)}". Options: ${listed(keys)}.`
        );
      }
    }
  }

  // -- Segments -----------------------------------------------------------

  private cut(flow: Flow, step: string, why: string, conditional: boolean) {
    flow.committedWrite ||= flow.wroteInSegment;
    flow.wroteInSegment = false;
    // The step that cuts runs between the two segments, in neither.
    if (this.current.steps.at(-1) === step) {
      this.current.steps.pop();
    }
    this.segments.push({
      ...this.current,
      ends: { step, why, conditional },
    });
    this.current = { steps: [], queued: [] };
  }

  /** A step that fails after a commit needs a way out (decision 0046). */
  private wayOut(
    flow: Flow,
    mode: Mode,
    onFailure: OnFailure | undefined,
    path: ConfigPath,
    label: string
  ) {
    if (mode.recovering || mode.covered || onFailure || !flow.committedWrite) {
      return;
    }
    this.problem(
      path,
      `${label} can fail after earlier changes are committed, so it needs on_failure: steps that undo them, or on_failure: leave to keep them.`
    );
  }

  private recovery(
    onFailure: OnFailure | undefined,
    path: ConfigPath,
    scope: Scope
  ) {
    if (Array.isArray(onFailure)) {
      this.inRecovery(
        onFailure as readonly Step[],
        [...path, "on_failure"],
        scope
      );
    }
  }

  /** `on_failure` steps: a segment of their own, not in the main list. */
  private inRecovery(steps: readonly Step[], path: ConfigPath, scope: Scope) {
    const saved = this.current;
    const count = this.segments.length;
    this.steps(
      steps,
      path,
      newFlow(scope.ran),
      {
        covered: true,
        conditional: true,
        recovering: true,
      },
      scope
    );
    this.segments.length = count;
    this.current = saved;
  }

  // -- Steps --------------------------------------------------------------

  /** Walks `steps` in order; true when every path through them ends. */
  steps(
    steps: readonly Step[],
    path: ConfigPath,
    flow: Flow,
    mode: Mode,
    base: Scope
  ): boolean {
    for (const [index, step] of steps.entries()) {
      const at = [...path, index];
      const scope = { ...base, ran: flow.ran };
      if (this.step(step, at, flow, mode, scope)) {
        if (index < steps.length - 1) {
          this.problem(
            [...path, index + 1],
            "Nothing after a fail or output step runs. Remove these steps or move them into a branch."
          );
        }
        return true;
      }
    }
    return false;
  }

  /** Checks one step and moves `flow` past it; true when it ends the run. */
  private step(
    step: Step,
    path: ConfigPath,
    flow: Flow,
    mode: Mode,
    scope: Scope
  ): boolean {
    const id = stepIdOf(step);
    if (id && !mode.recovering) {
      this.current.steps.push(id);
    }
    if ("action" in step) {
      this.actionStep(step, path, flow, mode, scope);
      return false;
    }
    if ("if" in step) {
      return this.ifStep(step, path, flow, mode, scope);
    }
    if ("wait" in step) {
      this.readOnlyRefuses(path, "wait");
      if ("until" in step.wait) {
        this.source(
          step.wait.until,
          { type: "string" },
          [...path, "wait", "until"],
          "wait until",
          scope
        );
      }
      if (!mode.recovering) {
        this.cut(flow, step.id, "waits", mode.conditional);
      }
      return false;
    }
    if ("wait_for_approval" in step) {
      this.approvalStep(step, path, flow, mode, scope);
      return false;
    }
    if ("run" in step) {
      this.runStep(step, path, flow, mode, scope);
      return false;
    }
    if ("emit" in step) {
      this.emitStep(step, path, flow, scope);
      return false;
    }
    if ("fail" in step) {
      if (!Object.hasOwn(this.workflow.errors ?? {}, step.fail)) {
        this.problem(
          [...path, "fail"],
          `"${step.fail}" isn't one of this workflow's errors. Declare it under errors with a message. Errors: ${listed(Object.keys(this.workflow.errors ?? {}))}.`
        );
      }
      this.wayOut(flow, mode, step.on_failure, path, `fail: ${step.fail}`);
      this.recovery(step.on_failure, path, scope);
      return true;
    }
    this.outputs(step.output, [...path, "output"], scope);
    return true;
  }

  private readOnlyRefuses(path: ConfigPath, what: string) {
    if (this.workflow.read_only) {
      this.problem(path, `A read_only workflow can't ${what}.`);
    }
  }

  private actionStep(
    step: Extract<Step, { action: string }>,
    path: ConfigPath,
    flow: Flow,
    mode: Mode,
    scope: Scope
  ) {
    const action = this.action(step.action);
    if (!action) {
      this.problem(
        [...path, "action"],
        `There is no action "${step.action}". fx describe lists the step actions.`
      );
      flow.ran.set(step.id, {});
      return;
    }
    const { name } = action;
    this.with(
      step.with,
      jsonOf(action.input, "input"),
      path,
      name,
      scope,
      action.fixedInputs
    );
    if (
      this.workflow.read_only &&
      (action.kind === "external" || !action.readOnly)
    ) {
      this.problem(
        [...path, "action"],
        `${name} writes, so a read_only workflow can't run it.`
      );
    }
    if (action.kind === "external" && !mode.recovering) {
      if (this.read.has(step.id)) {
        // The run commits, runs it, and goes on with its output.
        this.cut(
          flow,
          step.id,
          "runs outside the transaction, and a later step reads its output",
          mode.conditional
        );
        this.wayOut(flow, mode, step.on_failure, path, name);
        flow.committedWrite = true;
      } else {
        // Sent once its segment commits; it fails after that commit.
        this.current.steps.pop();
        this.current.queued.push(step.id);
        this.wayOut(
          {
            ...flow,
            committedWrite: flow.committedWrite || flow.wroteInSegment,
          },
          mode,
          step.on_failure,
          path,
          name
        );
      }
    } else {
      this.wayOut(flow, mode, step.on_failure, path, name);
      flow.wroteInSegment ||= !action.readOnly;
    }
    this.recovery(step.on_failure, path, scope);
    flow.ran.set(step.id, jsonOf(action.output, "output"));
  }

  private ifStep(
    step: Extract<Step, { if: readonly Condition[] }>,
    path: ConfigPath,
    flow: Flow,
    mode: Mode,
    scope: Scope
  ): boolean {
    for (const [index, condition] of step.if.entries()) {
      this.condition(condition, [...path, "if", index], scope);
    }
    const inner = {
      ...mode,
      covered: mode.covered || step.on_failure !== undefined,
      conditional: true,
    };
    const then = branch(flow);
    const thenEnds = this.steps(
      step.then,
      [...path, "then"],
      then,
      inner,
      scope
    );
    const otherwise = branch(flow);
    const elseEnds = step.else
      ? this.steps(step.else, [...path, "else"], otherwise, inner, scope)
      : false;
    flow.committedWrite = then.committedWrite || otherwise.committedWrite;
    flow.wroteInSegment = then.wroteInSegment || otherwise.wroteInSegment;
    this.recovery(step.on_failure, path, scope);
    return thenEnds && elseEnds;
  }

  private approvalStep(
    step: Extract<Step, { wait_for_approval: unknown }>,
    path: ConfigPath,
    flow: Flow,
    mode: Mode,
    scope: Scope
  ) {
    this.readOnlyRefuses(path, "wait for approval");
    for (const [index, condition] of (
      step.wait_for_approval.when ?? []
    ).entries()) {
      this.condition(
        condition,
        [...path, "wait_for_approval", "when", index],
        scope
      );
    }
    if (!mode.recovering) {
      this.cut(flow, step.id, "waits for approval", mode.conditional);
    }
    // A rejection fails the step, after the commit before it.
    this.wayOut(flow, mode, step.on_failure, path, `${step.id} (a rejection)`);
    this.recovery(step.on_failure, path, scope);
  }

  private runStep(
    step: Extract<Step, { run: string }>,
    path: ConfigPath,
    flow: Flow,
    mode: Mode,
    scope: Scope
  ) {
    const child = this.other(step.run);
    if (step.run === this.workflow.key) {
      this.problem([...path, "run"], "A workflow can't run itself.");
    } else if (child) {
      this.with(
        step.with,
        jsonOf(schemaOf(child.input), "input"),
        path,
        step.run,
        scope
      );
      if (this.workflow.read_only && !child.read_only) {
        this.problem(
          [...path, "run"],
          `${step.run} isn't read_only, so a read_only workflow can't run it.`
        );
      }
      const behaviour = summarise(
        child,
        this.context,
        new Set([this.workflow.key])
      );
      this.wayOut(flow, mode, step.on_failure, path, step.run);
      if (behaviour.pauses && !mode.recovering) {
        flow.wroteInSegment ||= behaviour.writes;
        this.cut(
          flow,
          step.id,
          `runs ${step.run}, which may pause`,
          mode.conditional
        );
      } else {
        flow.wroteInSegment ||= behaviour.writes;
      }
    } else {
      this.problem([...path, "run"], `There is no workflow "${step.run}".`);
    }
    this.recovery(step.on_failure, path, scope);
    const outputs = Object.keys(child?.output ?? {});
    flow.ran.set(step.id, {
      type: "object",
      properties: Object.fromEntries(outputs.map((key) => [key, {}])),
    });
  }

  private emitStep(
    step: Extract<Step, { emit: string }>,
    path: ConfigPath,
    flow: Flow,
    scope: Scope
  ) {
    this.readOnlyRefuses(path, "emit events");
    const shape = this.eventShape(step.emit);
    if (shape) {
      const takes = shape.specs
        ? jsonOf(schemaOf(shape.specs), "input")
        : (shape.node ?? {});
      this.with(step.with, takes, path, step.emit, scope);
    } else {
      this.problem(
        [...path, "emit"],
        `There is no event "${step.emit}". Declare it under events with its fields.`
      );
    }
    flow.wroteInSegment = true;
    flow.ran.set(step.id, null);
  }

  private outputs(
    given: Readonly<Record<string, Source>>,
    path: ConfigPath,
    scope: Scope
  ) {
    for (const [key, source] of Object.entries(given)) {
      this.source(source, {}, [...path, key], `output ${key}`, scope);
    }
    const declared = this.workflow.output;
    if (declared && path[0] !== "output") {
      const wanted = Object.keys(declared).toSorted().join(", ");
      const got = Object.keys(given).toSorted().join(", ");
      if (wanted !== got) {
        this.problem(
          path,
          `An output step gives the workflow's output: ${wanted}. This gives ${got || "nothing"}.`
        );
      }
    }
  }

  // -- The whole workflow -------------------------------------------------

  /** The steps' ids, each once; a repeat is a problem. */
  private collectIds() {
    for (const [step, path] of allSteps(this.workflow)) {
      const id = stepIdOf(step);
      if (id && this.ids.has(id)) {
        this.problem(
          [...path, "id"],
          `Another step is already called "${id}". Step ids are unique in a workflow.`
        );
      }
      if (id) {
        this.ids.add(id);
      }
    }
  }

  private fields(specs: FieldSpecs | undefined, path: ConfigPath) {
    const { catalog } = this.context;
    for (const [name, spec] of Object.entries(specs ?? {})) {
      if (
        spec.type === "ref" &&
        spec.object !== "actor" &&
        !catalog.objects.has(spec.object)
      ) {
        this.problem(
          [...path, name, "object"],
          `There is no object "${spec.object}". Objects: ${listed(catalog.objects.keys())}.`
        );
      }
      if (spec.type === "choice" && !this.listExists(spec.list)) {
        this.problem(
          [...path, name, "list"],
          `There is no choice list "${spec.list}".`
        );
      }
    }
  }

  private declarations() {
    const { workflow } = this;
    for (const code of Object.keys(workflow.errors ?? {})) {
      if (builtIn.has(code)) {
        this.problem(
          ["errors", code],
          `"${code}" is a built-in error. Name this one for what went wrong, such as reason_required.`
        );
      }
    }
    this.fields(workflow.input, ["input"]);
    for (const [name, fields] of Object.entries(workflow.events ?? {})) {
      this.fields(fields, ["events", name]);
      if (this.context.catalog.events.has(name)) {
        this.problem(
          ["events", name],
          `"${name}" is already an event in the system. Emit it without declaring it here.`
        );
      }
    }
  }

  /** What the steps can read at the start, by how it starts. */
  private start(): Scope {
    const { workflow } = this;
    const starts = workflow.starts_when;
    const ran = new Map<string, Json | null>();
    if (starts === "called") {
      return { input: workflow.input ?? {}, event: undefined, ran };
    }
    if (workflow.input) {
      this.problem(
        ["input"],
        "Only a workflow that is called takes input. One an event starts reads event.…"
      );
    }
    if (workflow.read_only) {
      this.problem(
        ["read_only"],
        "A read_only workflow is called: it is served as GET."
      );
    }
    if (!("event" in starts)) {
      return { input: undefined, event: undefined, ran };
    }
    const event = this.eventShape(starts.event);
    if (!event) {
      this.problem(
        ["starts_when", "event"],
        `There is no event "${starts.event}".`
      );
    }
    const scope = { input: undefined, event: event ?? { node: {} }, ran };
    for (const [index, condition] of (starts.when ?? []).entries()) {
      this.condition(condition, ["starts_when", "when", index], scope);
    }
    return scope;
  }

  /** A warning for each record id taken with no ownership check. */
  private ownership() {
    const checked = new Set(
      allSteps(this.workflow).flatMap(([step]) => {
        if (!("action" in step) || step.action !== ownershipCheck) {
          return [];
        }
        const id = step.with?.id;
        return id && "from" in id ? [id.from] : [];
      })
    );
    for (const [name, spec] of Object.entries(this.workflow.input ?? {})) {
      if (
        spec.type === "ref" &&
        this.context.catalog.owners.has(spec.object) &&
        !checked.has(`input.${name}`)
      ) {
        this.warnings.push({
          path: ["input", name],
          message: `input.${name} takes a ${spec.object} id, but no step checks it belongs to the caller (${ownershipCheck}), so anyone who may call this workflow can act on any ${spec.object}.`,
        });
      }
    }
  }

  check(): WorkflowCheck {
    const { workflow } = this;
    this.collectIds();
    this.declarations();
    const scope = this.start();
    const flow = newFlow(scope.ran);
    const mode: Mode = {
      covered: workflow.on_failure !== undefined,
      conditional: false,
      recovering: false,
    };
    this.steps(workflow.steps, ["steps"], flow, mode, scope);
    this.outputs(workflow.output ?? {}, ["output"], {
      ...scope,
      ran: flow.ran,
    });
    if (Array.isArray(workflow.on_failure)) {
      this.inRecovery(workflow.on_failure as readonly Step[], ["on_failure"], {
        ...scope,
        ran: new Map(),
      });
    }
    this.segments.push({ ...this.current, ends: null });
    if (this.segments.length > 1 && !workflow.attention_role) {
      this.problem(
        ["steps"],
        "This workflow may commit and go on later, so it needs attention_role: the role whose inbox gets a run that fails after a commit."
      );
    }
    this.ownership();
    return {
      problems: this.problems,
      warnings: this.warnings,
      segments: this.segments,
    };
  }
}

/**
 * Checks `workflow` against the system in `context`: what must be fixed,
 * what's worth a look, and where its runs may commit and go on later.
 */
export const validateWorkflow = (
  workflow: WorkflowDefinition,
  context: WorkflowContext
): WorkflowCheck => new WorkflowChecker(workflow, context).check();
