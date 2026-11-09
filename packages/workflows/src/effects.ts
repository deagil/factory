// What a workflow may do that one transaction can't hold (P2.20): reach
// another system, or pause. A workflow that does neither runs in one
// transaction with no checkpoints; one that does runs durably, with DBOS.
import type { AnyActionDefinition } from "@workspace/actions";

import type { WorkflowDefinition } from "./schema.ts";
import { allSteps, readSteps } from "./validate.ts";

export interface Effects {
  /** It runs an external action, here or in a workflow it runs. */
  readonly external: boolean;
  /** It may pause: a wait, an approval, or an external step whose output it reads. */
  readonly pauses: boolean;
}

export const effectsOf = (
  workflow: WorkflowDefinition,
  actions: ReadonlyMap<string, AnyActionDefinition>,
  workflows: ReadonlyMap<string, WorkflowDefinition> | undefined,
  seen = new Set<string>()
): Effects => {
  if (seen.has(workflow.key)) {
    return { external: false, pauses: false };
  }
  seen.add(workflow.key);
  const read = readSteps(workflow);
  let external = false;
  let pauses = false;
  for (const [step] of allSteps(workflow)) {
    if ("action" in step && actions.get(step.action)?.kind === "external") {
      external = true;
      pauses ||= read.has(step.id);
    } else if ("wait" in step || "wait_for_approval" in step) {
      pauses = true;
    } else if ("run" in step) {
      const child = workflows?.get(step.run);
      if (child) {
        const inner = effectsOf(child, actions, workflows, seen);
        external ||= inner.external;
        pauses ||= inner.pauses;
      }
    }
  }
  return { external, pauses };
};
