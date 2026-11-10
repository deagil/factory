// A workflow's steps as a tree: each step with its path, its branches and
// its failure steps, in file order. The outline draws this; nothing here
// is kept in the file.
import type {
  Condition,
  Source,
  Step,
  WorkflowDefinition,
} from "@workspace/workflows";

import {
  conditionWords,
  conditionsWords,
  durationWords,
  listOf,
  pathParts,
  plain,
  sourceWords,
  titleOf,
} from "./workflow-words.ts";
import type { FactRow } from "./workflow-words.ts";

export type StepKind =
  | "action"
  | "if"
  | "wait"
  | "wait_for_approval"
  | "run"
  | "emit"
  | "fail"
  | "output";

export const stepKind = (step: Step): StepKind => {
  if ("action" in step) {
    return "action";
  }
  if ("if" in step) {
    return "if";
  }
  if ("wait" in step) {
    return "wait";
  }
  if ("wait_for_approval" in step) {
    return "wait_for_approval";
  }
  if ("run" in step) {
    return "run";
  }
  if ("emit" in step) {
    return "emit";
  }
  if ("fail" in step) {
    return "fail";
  }
  return "output";
};

/** The kind as one word, shown beside its icon. */
export const kindWords: Record<StepKind, string> = {
  action: "Action",
  if: "If",
  wait: "Wait",
  wait_for_approval: "Approval",
  run: "Workflow",
  emit: "Event",
  fail: "Fail",
  output: "Output",
};

export type GroupKind = "then" | "else" | "on_failure";

export interface TreeGroup {
  kind: GroupKind;
  /** `steps.1.then`: the path its steps sit under. */
  path: string;
  label: string;
  rows: TreeRow[];
}

export interface TreeRow {
  step: Step;
  kind: StepKind;
  /** `steps.2`, `steps.1.then.0`: the path the check uses for this step. */
  path: string;
  /** The step's id, or null for a `fail` or `output` that has none. */
  id: string | null;
  /** What the URL holds for this step: its id, or its path without one. */
  address: string;
  /** Its place among its siblings, from 1, and how many there are. */
  place: number;
  of: number;
  /** A `fail` or an `output`: the run stops here. */
  ends: boolean;
  /** A failure that is left as it is: `on_failure: leave`. */
  leaves: boolean;
  groups: TreeGroup[];
}

const groupLabels: Record<GroupKind, string> = {
  // oxlint-disable-next-line unicorn/no-thenable -- a step's branch, not a promise
  then: "Then",
  else: "Otherwise",
  on_failure: "If this fails after a commit",
};

const idOf = (step: Step) => ("id" in step && step.id ? step.id : null);

const failureOf = (step: Step) =>
  "on_failure" in step ? step.on_failure : undefined;

const branchesOf = (step: Step): [GroupKind, readonly Step[]][] => {
  const failure = failureOf(step);
  const branches: [GroupKind, readonly Step[] | undefined][] = [
    ["then", "if" in step ? step.then : undefined],
    ["else", "if" in step ? step.else : undefined],
    ["on_failure", Array.isArray(failure) ? failure : undefined],
  ];
  return branches.flatMap(([kind, steps]): [GroupKind, readonly Step[]][] =>
    steps ? [[kind, steps]] : []
  );
};

/** The steps under `base` as rows, with everything nested inside them. */
export const walkSteps = (steps: readonly Step[], base: string): TreeRow[] =>
  steps.map((step, index) => {
    const path = `${base}.${index}`;
    const id = idOf(step);
    const kind = stepKind(step);
    return {
      step,
      kind,
      path,
      id,
      address: id ?? path,
      place: index + 1,
      of: steps.length,
      ends: kind === "fail" || kind === "output",
      leaves: failureOf(step) === "leave",
      groups: branchesOf(step).map(([group, inner]) => ({
        kind: group,
        path: `${path}.${group}`,
        label: groupLabels[group],
        rows: walkSteps(inner, `${path}.${group}`),
      })),
    };
  });

const pathsOf = (values: readonly Source[]) =>
  values.flatMap((source) => ("from" in source ? [source.from] : []));

const unique = (names: readonly (string | null)[]) => [
  ...new Set(names.filter((name): name is string => name !== null)),
];

/** The ids of the steps these values read. */
const stepsRead = (values: readonly Source[]) =>
  unique(pathsOf(values).map((path) => pathParts(path).step));

export interface WorkflowTree {
  rows: TreeRow[];
  /** The workflow's own failure steps, for a step with none of its own. */
  onFailure: TreeGroup | null;
  /** The workflow leaves a failure as it is: `on_failure: leave`. */
  leaves: boolean;
  attentionRole: string | null;
  /** The steps the workflow's own output reads. */
  outputReads: string[];
}

const ownFailure = (definition: WorkflowDefinition): TreeGroup | null => {
  const failure = definition.on_failure;
  return Array.isArray(failure)
    ? {
        kind: "on_failure",
        path: "on_failure",
        label: "If any other step fails after a commit",
        rows: walkSteps(failure, "on_failure"),
      }
    : null;
};

export const workflowTree = (
  definition: WorkflowDefinition | null
): WorkflowTree => ({
  rows: definition ? walkSteps(definition.steps, "steps") : [],
  onFailure: definition ? ownFailure(definition) : null,
  leaves: definition?.on_failure === "leave",
  attentionRole: definition?.attention_role ?? null,
  outputReads: stepsRead(Object.values(definition?.output ?? {})),
});

const below = (row: TreeRow): TreeRow[] => [
  row,
  ...row.groups.flatMap((group) => group.rows.flatMap(below)),
];

/** Every row, nested ones included, in the order the file has them. */
export const allRows = (tree: WorkflowTree): TreeRow[] => [
  ...tree.rows.flatMap(below),
  ...(tree.onFailure?.rows.flatMap(below) ?? []),
];

/** The step the URL names, by its id or its path. */
export const findRow = (
  tree: WorkflowTree,
  address: string | undefined
): TreeRow | undefined =>
  address === undefined
    ? undefined
    : allRows(tree).find((row) => row.id === address || row.path === address);

const shown = (row: TreeRow, collapsed: ReadonlySet<string>): TreeRow[] => [
  row,
  ...row.groups.flatMap((group) =>
    collapsed.has(group.path)
      ? []
      : group.rows.flatMap((each) => shown(each, collapsed))
  ),
];

/** The rows on screen, top to bottom, skipping collapsed branches. */
export const visibleRows = (
  tree: WorkflowTree,
  collapsed: ReadonlySet<string>
): TreeRow[] => [
  ...tree.rows.flatMap((row) => shown(row, collapsed)),
  ...(tree.onFailure && !collapsed.has(tree.onFailure.path)
    ? tree.onFailure.rows.flatMap((row) => shown(row, collapsed))
    : []),
];

/** The branches a row is inside, outermost first, so a link can open them. */
export const groupsAround = (path: string): string[] => {
  const parts = path.split(".");
  return parts.flatMap((part, index) =>
    index > 0 && Number.isNaN(Number(part))
      ? [parts.slice(0, index + 1).join(".")]
      : []
  );
};

// ---------------------------------------------------------------------------
// A row in words

const approvalWords = (step: Extract<Step, { wait_for_approval: unknown }>) => {
  const { approver, approvals } = step.wait_for_approval;
  const who = plain(approver);
  return approvals && approvals > 1
    ? `Waits for ${approvals} approvals from the ${who} role`
    : `Waits for approval from the ${who} role`;
};

const waitWords = (step: Extract<Step, { wait: unknown }>) =>
  "for" in step.wait
    ? `Waits ${durationWords(step.wait.for)}`
    : `Waits until ${sourceWords(step.wait.until)}`;

/** What a step does, as a sentence with no full stop. */
export const stepWords = (step: Step): string => {
  if ("action" in step) {
    return `Runs ${plain(step.action)}`;
  }
  if ("if" in step) {
    return `If ${conditionsWords(step.if)}`;
  }
  if ("wait" in step) {
    return waitWords(step);
  }
  if ("wait_for_approval" in step) {
    return approvalWords(step);
  }
  if ("run" in step) {
    return `Runs the workflow ${plain(step.run)} and waits for it`;
  }
  if ("emit" in step) {
    return `Emits ${plain(step.emit)}`;
  }
  if ("fail" in step) {
    return `Fails with ${plain(step.fail)}`;
  }
  return "Gives back its output";
};

/** The row's name: its id as a title, or for a step with none, its kind. */
export const rowTitle = (row: TreeRow): string =>
  row.id ? titleOf(row.id) : kindWords[row.kind];

/** What a screen reader hears: place, name, what it does and its kind. */
export const rowName = (row: TreeRow): string =>
  [
    `Step ${row.place} of ${row.of}`,
    rowTitle(row),
    stepWords(row.step),
    kindWords[row.kind].toLowerCase(),
    ...(row.ends ? ["ends the run"] : []),
  ].join(", ");

// ---------------------------------------------------------------------------
// A step's detail

/** One input: its name, where it comes from, and the step it reads, if any. */
export interface DetailRow extends FactRow {
  reads: string | null;
}

export interface StepDetail {
  /** Each input, and where its value comes from. */
  inputs: DetailRow[];
  /** Conditions, for an `if` or an approval that asks only sometimes. */
  conditions: string[];
  /** Other settings, such as an approval's roles or a failure's message. */
  settings: FactRow[];
}

const sources = (
  values: Readonly<Record<string, Source>> | undefined
): DetailRow[] =>
  Object.entries(values ?? {}).map(([name, source]) => ({
    name,
    words: sourceWords(source),
    reads: "from" in source ? pathParts(source.from).step : null,
  }));

const withOf = (step: Step) => {
  if ("output" in step) {
    return step.output;
  }
  return "with" in step ? step.with : undefined;
};

const conditionsOf = (step: Step): readonly Condition[] => {
  if ("if" in step) {
    return step.if;
  }
  return "wait_for_approval" in step ? (step.wait_for_approval.when ?? []) : [];
};

const roles = (names: readonly string[] | undefined) =>
  names ? listOf(names.map(plain)) : undefined;

const approvalSettings = (step: Step): [string, string | undefined][] => {
  if (!("wait_for_approval" in step)) {
    return [];
  }
  const approval = step.wait_for_approval;
  return [
    ["approver", plain(approval.approver)],
    ["approvals", String(approval.approvals ?? 1)],
    ["asks only callers who are", roles(approval.requester)],
    ["never asks callers who are", roles(approval.exempt)],
    ["message", approval.message],
  ];
};

const settingsOf = (step: Step): [string, string | undefined][] => [
  ...approvalSettings(step),
  ["message", "fail" in step ? step.message : undefined],
  [
    "on failure",
    failureOf(step) === "leave" ? "left as it is, for a person" : undefined,
  ],
];

/** Everything a step is given, read-only. */
export const stepDetail = (step: Step): StepDetail => ({
  inputs: sources(withOf(step)),
  conditions: conditionsOf(step).map(conditionWords),
  settings: settingsOf(step).flatMap(([name, words]): FactRow[] =>
    words === undefined ? [] : [{ name, words }]
  ),
});

// ---------------------------------------------------------------------------
// What reads what

const valuesOf = (step: Step): Source[] => [
  ...Object.values(withOf(step) ?? {}),
  ...("wait" in step && "until" in step.wait ? [step.wait.until] : []),
];

/** The ids of the steps this step reads, in its inputs and its conditions. */
export const stepReads = (step: Step): string[] =>
  unique(
    [
      ...pathsOf(valuesOf(step)),
      ...conditionsOf(step).map((condition) => condition.field),
    ].map((path) => pathParts(path).step)
  );

/** For each step id, the rows that read its output. */
export const readersOf = (tree: WorkflowTree): Map<string, TreeRow[]> => {
  const readers = new Map<string, TreeRow[]>();
  for (const row of allRows(tree)) {
    for (const id of stepReads(row.step)) {
      readers.set(id, [...(readers.get(id) ?? []), row]);
    }
  }
  return readers;
};

// ---------------------------------------------------------------------------
// Collapsed branches, kept per workflow

export const collapsedKey = (workflow: string) =>
  `factory-workflow-collapsed:${workflow}`;

/** The saved list of collapsed branch paths. Anything else reads as none. */
export const readCollapsed = (saved: string | null): Set<string> => {
  try {
    const value: unknown = JSON.parse(saved ?? "[]");
    return new Set(
      Array.isArray(value)
        ? value.filter((each): each is string => typeof each === "string")
        : []
    );
  } catch {
    return new Set();
  }
};

export const toggled = (
  collapsed: ReadonlySet<string>,
  path: string
): Set<string> => {
  const next = new Set(collapsed);
  if (!next.delete(path)) {
    next.add(path);
  }
  return next;
};

// ---------------------------------------------------------------------------
// The keyboard

export type OutlineMove =
  | { focus: string }
  | { collapse: string }
  | { expand: string }
  | null;

const firstGroup = (row: TreeRow) => row.groups[0]?.path;

const sideways = (
  row: TreeRow,
  key: string,
  collapsed: ReadonlySet<string>
): OutlineMove => {
  const open = row.groups.find((group) => !collapsed.has(group.path));
  const closed = row.groups.find((group) => collapsed.has(group.path));
  if (key === "ArrowLeft" && open) {
    return { collapse: open.path };
  }
  if (key === "ArrowRight" && closed) {
    return { expand: closed.path };
  }
  return null;
};

/**
 * What a key does on a row: up and down move between the rows on screen,
 * left closes the row's branches and right opens them.
 */
export const outlineMove = (input: {
  tree: WorkflowTree;
  collapsed: ReadonlySet<string>;
  path: string;
  key: string;
}): OutlineMove => {
  const rows = visibleRows(input.tree, input.collapsed);
  const index = rows.findIndex((row) => row.path === input.path);
  const row = rows[index];
  if (!row) {
    return null;
  }
  if (input.key === "ArrowDown" || input.key === "ArrowUp") {
    const next = rows[index + (input.key === "ArrowDown" ? 1 : -1)];
    return next ? { focus: next.path } : null;
  }
  return firstGroup(row) ? sideways(row, input.key, input.collapsed) : null;
};

// ---------------------------------------------------------------------------
// One path of a condition, or a step's failure steps, on its own

export interface PathView {
  /** `steps.1.then`: what the URL holds for this path. */
  path: string;
  /** "Then", "Otherwise" or "If it fails". */
  label: string;
  /** The step the path hangs off. */
  owner: TreeRow;
  rows: TreeRow[];
  /** The condition's other path, to step across to. */
  other: { path: string; label: string } | null;
  /** The step the run goes on to after this path, if there is one. */
  joins: TreeRow | null;
  /** What happens after the last step, as a sentence. */
  after: string;
}

const pathLabels: Record<GroupKind, string> = {
  // oxlint-disable-next-line unicorn/no-thenable -- a step's branch, not a promise
  then: "Then",
  else: "Otherwise",
  on_failure: "If it fails",
};

const isGroupKind = (name: string | undefined): name is GroupKind =>
  name === "then" || name === "else" || name === "on_failure";

/** A path split into the step that owns it and which of its paths it is. */
const pathOwner = (path: string) => {
  const parts = path.split(".");
  const kind = parts.at(-1);
  return isGroupKind(kind)
    ? { kind, owner: parts.slice(0, -1).join(".") }
    : null;
};

/** The step a run reaches after `row` and everything inside it. */
const stepAfter = (tree: WorkflowTree, row: TreeRow): TreeRow | null => {
  const parent = row.path.split(".").slice(0, -1).join(".");
  const next = allRows(tree).find(
    (each) => each.path === `${parent}.${row.place}`
  );
  if (next) {
    return next;
  }
  const around = pathOwner(parent);
  const owner =
    around && around.kind !== "on_failure"
      ? findRow(tree, around.owner)
      : undefined;
  return owner ? stepAfter(tree, owner) : null;
};

const afterWords = (input: {
  kind: GroupKind;
  rows: readonly TreeRow[];
  joins: TreeRow | null;
}) => {
  if (input.rows.at(-1)?.ends) {
    return "The run stops at the end of this path.";
  }
  if (input.kind === "on_failure") {
    return "The run has failed. Nothing follows these steps.";
  }
  return input.joins
    ? `Joins the main path again at ${rowTitle(input.joins)}.`
    : "The workflow ends after this path.";
};

/** The path the URL names, or undefined when no step has such a path. */
export const pathView = (
  tree: WorkflowTree,
  path: string | undefined
): PathView | undefined => {
  const named = path === undefined ? null : pathOwner(path);
  const owner = named ? findRow(tree, named.owner) : undefined;
  if (!named || !owner || path === undefined) {
    return undefined;
  }
  const group = owner.groups.find((each) => each.kind === named.kind);
  const branch = named.kind !== "on_failure";
  if (!group && !(branch && owner.kind === "if")) {
    return undefined;
  }
  const rows = group?.rows ?? [];
  const otherKind = named.kind === "then" ? "else" : "then";
  const joins = branch ? stepAfter(tree, owner) : null;
  return {
    path,
    label: pathLabels[named.kind],
    owner,
    rows,
    other: branch
      ? { path: `${owner.path}.${otherKind}`, label: pathLabels[otherKind] }
      : null,
    joins,
    after: afterWords({ kind: named.kind, rows, joins }),
  };
};

/** Whether a step sits anywhere inside a path. */
export const insidePath = (row: TreeRow, path: string | undefined) =>
  path !== undefined && row.path.startsWith(`${path}.`);
