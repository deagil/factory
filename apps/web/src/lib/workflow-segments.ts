// Where a run commits part-way and may pause, who can call a workflow and
// who it acts as. The cuts come from the check, in its own words.
import type { WorkflowCheck, WorkflowProblem } from "@workspace/workflows";

import type { Role } from "./roles.ts";
import { listOf } from "./workflow-words.ts";

export interface Cut {
  /** The id of the step that cuts. */
  step: string;
  /** "Commits here: this step waits." */
  text: string;
  conditional: boolean;
}

/** Each step that ends a segment, by its id. */
export const cutsOf = (check: WorkflowCheck | undefined): Map<string, Cut> =>
  new Map(
    (check?.segments ?? []).flatMap((segment): [string, Cut][] => {
      const { ends } = segment;
      if (!ends) {
        return [];
      }
      const only = ends.conditional ? " Only if this branch runs." : "";
      return [
        [
          ends.step,
          {
            step: ends.step,
            text: `Commits here: this step ${ends.why}.${only}`,
            conditional: ends.conditional,
          },
        ],
      ];
    })
  );

/** External steps nothing reads: sent once their segment commits. */
export const queuedOf = (check: WorkflowCheck | undefined): Set<string> =>
  new Set((check?.segments ?? []).flatMap((segment) => segment.queued));

/** "May pause in 2 places", or null for a run that commits once. */
export const pauseWords = (count: number): string | null => {
  if (count === 0) {
    return null;
  }
  return `May pause in ${count} ${count === 1 ? "place" : "places"}`;
};

/** The roles whose callers may run this workflow. */
export const rolesCalling = (
  roles: readonly Role[] | undefined,
  workflow: string
): Role[] =>
  (roles ?? []).filter(
    (role) => role.workflows === "*" || role.workflows?.includes(workflow)
  );

const isCalled = (starts: unknown) => starts === "called";

const startedBy = (starts: unknown) =>
  typeof starts === "object" && starts !== null && "schedule" in starts
    ? "a schedule"
    : "an event";

/** Who can call it, as a sentence. */
export const callersWords = (input: {
  starts: unknown;
  /** Undefined when the viewer can't read roles. */
  roles: readonly Role[] | undefined;
  workflow: string;
}): string => {
  if (!isCalled(input.starts)) {
    return `Nothing can call it: ${startedBy(input.starts)} starts it.`;
  }
  if (input.roles === undefined) {
    return "People whose roles name it can call it.";
  }
  const labels = rolesCalling(input.roles, input.workflow).map(
    (role) => role.label
  );
  if (labels.length === 0) {
    return "No role names it, so nobody can call it.";
  }
  return `People with the ${listOf(labels)} ${labels.length === 1 ? "role" : "roles"} can call it.`;
};

export const actsAsWords =
  "Its steps run with full access. Each run records this workflow as the actor and the person who started it as the origin user.";

/** Warnings about the input, such as a record nobody checks the caller owns. */
export const inputWarnings = (
  check: WorkflowCheck | undefined
): WorkflowProblem[] =>
  (check?.warnings ?? []).filter((warning) => warning.path[0] === "input");
