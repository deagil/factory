// Where a step is in a workflow (P2.20): its path through the step lists,
// such as [3, "then", 1] for the second step of the fourth step's `then`.
// A run that pauses saves where it got to as a path, and goes on from there.
import type { OnFailure, Step, WorkflowDefinition } from "./schema.ts";

export type Pos = number | "then" | "else";
export type Path = readonly Pos[];

/**
 * A list of steps a run walks: the workflow's `steps`, or the `on_failure`
 * steps of the step at a path in them (null: the workflow's own).
 */
export type ListRef = "steps" | { readonly on_failure: Path | null };

/** The step at `path` in `steps`, or undefined. */
export const stepAt = (
  steps: readonly Step[],
  path: Path
): Step | undefined => {
  const [index, branch, ...rest] = path;
  const step = typeof index === "number" ? steps[index] : undefined;
  if (!step || branch === undefined) {
    return step;
  }
  if (!("if" in step)) {
    return undefined;
  }
  const inner = branch === "then" ? step.then : (step.else ?? []);
  return stepAt(inner, rest);
};

const stepsOf = (onFailure: OnFailure | undefined) =>
  Array.isArray(onFailure) ? (onFailure as readonly Step[]) : [];

/** The steps `list` names in `workflow`. */
export const listOf = (
  workflow: WorkflowDefinition,
  list: ListRef
): readonly Step[] => {
  if (list === "steps") {
    return workflow.steps;
  }
  if (list.on_failure === null) {
    return stepsOf(workflow.on_failure);
  }
  const owner = stepAt(workflow.steps, list.on_failure);
  return stepsOf(owner && "on_failure" in owner ? owner.on_failure : undefined);
};

/**
 * What undoes a failure of the step at `path` in `workflow.steps`: the
 * `on_failure` of the step itself or the nearest step around it, else the
 * workflow's. Null when nothing names one.
 */
export const failureStepsFor = (
  workflow: WorkflowDefinition,
  path: Path
): { readonly owner: Path | null; readonly onFailure: OnFailure } | null => {
  for (let end = path.length; end > 0; end -= 1) {
    const at = path.slice(0, end);
    if (typeof at.at(-1) === "number") {
      const step = stepAt(workflow.steps, at);
      if (step && "on_failure" in step && step.on_failure !== undefined) {
        return { owner: at, onFailure: step.on_failure };
      }
    }
  }
  return workflow.on_failure === undefined
    ? null
    : { owner: null, onFailure: workflow.on_failure };
};
