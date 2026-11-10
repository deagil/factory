// Changes to a workflow's steps, each a pure function from one definition
// to the next. A step is named by its path (`steps.1.then.0`) and a place
// to put one by a slot: a list of steps and an index in it. A menu command,
// a key and a drop on the canvas all end in the same function here.
import type { Step, WorkflowDefinition } from "@workspace/workflows";

type Steps = readonly Step[];
type Group = "then" | "else" | "on_failure";

/** A place a step can go: before the step at `index` of the list. */
export interface Slot {
  /** `steps`, `steps.1.then`, `steps.2.on_failure` or `on_failure`. */
  list: string;
  index: number;
}

/** What a change gives back: the new definition, and where the step is now. */
export interface Changed {
  definition: WorkflowDefinition;
  path: string;
}

const isGroup = (name: string | undefined): name is Group =>
  name === "then" || name === "else" || name === "on_failure";

/** The list a step is in, and its place there. */
export const slotOf = (path: string): Slot => {
  const parts = path.split(".");
  return { list: parts.slice(0, -1).join("."), index: Number(parts.at(-1)) };
};

const pathOf = (slot: Slot) => `${slot.list}.${slot.index}`;

const groupSteps = (step: Step, group: Group): Steps | undefined => {
  if (group === "on_failure") {
    const failure = "on_failure" in step ? step.on_failure : undefined;
    return Array.isArray(failure) ? failure : undefined;
  }
  if (!("if" in step)) {
    return undefined;
  }
  return group === "then" ? step.then : step.else;
};

/** The step with one of its lists replaced. An emptied `else` or `on_failure` goes. */
const withGroup = (step: Step, group: Group, steps: Steps): Step => {
  if (group === "on_failure") {
    if ("wait" in step || "emit" in step || "output" in step) {
      return step;
    }
    return { ...step, on_failure: steps.length > 0 ? steps : undefined };
  }
  if (!("if" in step)) {
    return step;
  }
  return group === "then"
    ? // oxlint-disable-next-line unicorn/no-thenable -- a step's branch, not a promise
      { ...step, then: steps }
    : { ...step, else: steps.length > 0 ? steps : undefined };
};

const rootSteps = (definition: WorkflowDefinition, root: string): Steps => {
  if (root === "steps") {
    return definition.steps;
  }
  return Array.isArray(definition.on_failure) ? definition.on_failure : [];
};

/** The steps in a list, or none when nothing has that path. */
export const listAt = (definition: WorkflowDefinition, list: string): Steps => {
  const [root = "steps", ...rest] = list.split(".");
  let steps = rootSteps(definition, root);
  for (let at = 0; at < rest.length; at += 2) {
    const owner = steps[Number(rest[at])];
    const group = rest[at + 1];
    steps = owner && isGroup(group) ? (groupSteps(owner, group) ?? []) : [];
  }
  return steps;
};

export const stepAt = (
  definition: WorkflowDefinition,
  path: string
): Step | undefined => {
  const slot = slotOf(path);
  return listAt(definition, slot.list)[slot.index];
};

const replaceList = (
  definition: WorkflowDefinition,
  list: string,
  next: Steps
): WorkflowDefinition => {
  const parts = list.split(".");
  if (parts.length === 1) {
    return list === "steps"
      ? { ...definition, steps: next }
      : { ...definition, on_failure: next.length > 0 ? next : undefined };
  }
  const group = parts.at(-1);
  const index = Number(parts.at(-2));
  const parentList = parts.slice(0, -2).join(".");
  const parent = listAt(definition, parentList);
  const owner = parent[index];
  if (!owner || !isGroup(group)) {
    return definition;
  }
  return replaceList(
    definition,
    parentList,
    parent.map((step, at) =>
      at === index ? withGroup(owner, group, next) : step
    )
  );
};

export const insertStep = (
  definition: WorkflowDefinition,
  slot: Slot,
  step: Step
): Changed => {
  const steps = listAt(definition, slot.list);
  const index = Math.min(Math.max(slot.index, 0), steps.length);
  return {
    definition: replaceList(definition, slot.list, [
      ...steps.slice(0, index),
      step,
      ...steps.slice(index),
    ]),
    path: pathOf({ list: slot.list, index }),
  };
};

export const removeStep = (
  definition: WorkflowDefinition,
  path: string
): WorkflowDefinition => {
  const slot = slotOf(path);
  return replaceList(
    definition,
    slot.list,
    listAt(definition, slot.list).filter((_step, at) => at !== slot.index)
  );
};

/** A slot's name once the step at `from` is gone: later siblings move up one. */
const afterRemoval = (slot: Slot, from: Slot): Slot => {
  if (slot.list === from.list) {
    return slot.index > from.index
      ? { list: slot.list, index: slot.index - 1 }
      : slot;
  }
  const base = from.list.split(".");
  const parts = slot.list.split(".");
  const through = Number(parts[base.length]);
  if (!slot.list.startsWith(`${from.list}.`) || through <= from.index) {
    return slot;
  }
  parts[base.length] = String(through - 1);
  return { list: parts.join("."), index: slot.index };
};

/** Move a step to a slot. Null when that changes nothing or can't be done. */
export const moveStep = (
  definition: WorkflowDefinition,
  path: string,
  to: Slot
): Changed | null => {
  const from = slotOf(path);
  const step = stepAt(definition, path);
  const stays =
    to.list === from.list &&
    (to.index === from.index || to.index === from.index + 1);
  const inside = to.list === path || to.list.startsWith(`${path}.`);
  if (!step || stays || inside) {
    return null;
  }
  return insertStep(removeStep(definition, path), afterRemoval(to, from), step);
};

/** One place up or down among its siblings. */
export const moveBy = (
  definition: WorkflowDefinition,
  path: string,
  by: -1 | 1
): Changed | null => {
  const { list, index } = slotOf(path);
  const last = listAt(definition, list).length - 1;
  if ((by === -1 && index === 0) || (by === 1 && index >= last)) {
    return null;
  }
  return moveStep(definition, path, {
    list,
    index: by === -1 ? index - 1 : index + 2,
  });
};

/** To the end of the Then path of the condition just before it. */
export const moveInto = (
  definition: WorkflowDefinition,
  path: string
): Changed | null => {
  const { list, index } = slotOf(path);
  const before = listAt(definition, list)[index - 1];
  if (!before || !("if" in before)) {
    return null;
  }
  return moveStep(definition, path, {
    list: `${list}.${index - 1}.then`,
    index: before.then.length,
  });
};

/** Out of its path, to just after the step that owns the path. */
export const moveOut = (
  definition: WorkflowDefinition,
  path: string
): Changed | null => {
  const parts = slotOf(path).list.split(".");
  if (parts.length < 3) {
    return null;
  }
  const owner = slotOf(parts.slice(0, -1).join("."));
  return moveStep(definition, path, {
    list: owner.list,
    index: owner.index + 1,
  });
};

// ---------------------------------------------------------------------------
// Ids

const idsIn = (steps: Steps): string[] =>
  steps.flatMap((step) => [
    ...("id" in step && step.id ? [step.id] : []),
    ...(["then", "else", "on_failure"] as const).flatMap((group) =>
      idsIn(groupSteps(step, group) ?? [])
    ),
  ]);

/** Every step id in the workflow. */
export const stepIds = (definition: WorkflowDefinition): string[] => [
  ...idsIn(definition.steps),
  ...idsIn(rootSteps(definition, "on_failure")),
];

/** `base`, or `base_2`, `base_3`… when that is taken. */
export const uniqueId = (taken: readonly string[], base: string): string => {
  if (!taken.includes(base)) {
    return base;
  }
  let count = 2;
  while (taken.includes(`${base}_${count}`)) {
    count += 1;
  }
  return `${base}_${count}`;
};

const idPattern = /^[a-z][a-z0-9]*(?:_[a-z0-9]+)*$/u;

/** What is wrong with a new id for a step, or null. */
export const idProblem = (
  definition: WorkflowDefinition,
  id: string,
  current: string | null
): string | null => {
  if (!idPattern.test(id)) {
    return "Use lower-case letters, numbers and underscores, starting with a letter.";
  }
  return id !== current && stepIds(definition).includes(id)
    ? `Another step is already called ${id}.`
    : null;
};

/** A copy of a step, and of the steps inside it, each with an id of its own. */
const copied = (step: Step, taken: string[]): Step => {
  let next = step;
  if ("id" in next && next.id) {
    const id = uniqueId(taken, `${next.id}_copy`);
    taken.push(id);
    next = { ...next, id };
  }
  for (const group of ["then", "else", "on_failure"] as const) {
    const inner = groupSteps(next, group);
    if (inner) {
      next = withGroup(
        next,
        group,
        inner.map((each) => copied(each, taken))
      );
    }
  }
  return next;
};

/** A copy of the step, placed just after it. */
export const duplicateStep = (
  definition: WorkflowDefinition,
  path: string
): Changed | null => {
  const step = stepAt(definition, path);
  const { list, index } = slotOf(path);
  return step
    ? insertStep(
        definition,
        { list, index: index + 1 },
        copied(step, stepIds(definition))
      )
    : null;
};

const renamedRef = (ref: string, from: string, to: string) => {
  const old = `steps.${from}`;
  if (ref === old) {
    return `steps.${to}`;
  }
  return ref.startsWith(`${old}.`)
    ? `steps.${to}${ref.slice(old.length)}`
    : ref;
};

const renamedIn = (value: unknown, from: string, to: string): unknown => {
  if (Array.isArray(value)) {
    return value.map((each) => renamedIn(each, from, to));
  }
  if (typeof value !== "object" || value === null) {
    return value;
  }
  return Object.fromEntries(
    Object.entries(value).map(([key, inner]) => {
      if (typeof inner !== "string") {
        return [key, renamedIn(inner, from, to)];
      }
      if (key === "id" && inner === from) {
        return [key, to];
      }
      return [
        key,
        key === "from" || key === "field" ? renamedRef(inner, from, to) : inner,
      ];
    })
  );
};

/** Give a step another id, and point everything that read the old one at it. */
export const renameStep = (
  definition: WorkflowDefinition,
  from: string,
  to: string
): WorkflowDefinition => ({
  ...definition,
  steps: renamedIn(definition.steps, from, to) as Steps,
  output: renamedIn(
    definition.output,
    from,
    to
  ) as WorkflowDefinition["output"],
  on_failure: renamedIn(
    definition.on_failure,
    from,
    to
  ) as WorkflowDefinition["on_failure"],
});

// ---------------------------------------------------------------------------
// New steps

export type NewStep =
  | { kind: "action"; action: string }
  | { kind: "if" }
  | { kind: "wait" };

/** A step to start from. A condition's Then path is empty until a step is put in it. */
export const newStep = (
  definition: WorkflowDefinition,
  choice: NewStep
): Step => {
  const taken = stepIds(definition);
  if (choice.kind === "action") {
    return { id: uniqueId(taken, choice.action), action: choice.action };
  }
  if (choice.kind === "wait") {
    return { id: uniqueId(taken, "wait"), wait: { for: "1d" } };
  }
  const [field] = Object.keys(definition.input ?? {});
  return {
    id: uniqueId(taken, "check"),
    if: [{ field: field ? `input.${field}` : "input", empty: false }],
    // oxlint-disable-next-line unicorn/no-thenable -- a step's branch, not a promise
    then: [],
  };
};
