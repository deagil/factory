// defineWorkflow (P2.16, decision 0048): a workflow in TypeScript, for the
// core and modules, in the same shape as `config/workflows/<key>.yaml`.
// The schema checks its shape here; the system validates it against its
// actions and objects when it is defined (defineSystem).
import { z } from "zod";

import { workflowSchema } from "./schema.ts";
import type { WorkflowDefinition } from "./schema.ts";

export type WorkflowInput = z.input<typeof workflowSchema>;

/** Defines a workflow, refusing one whose shape is wrong. */
export const defineWorkflow = (
  definition: WorkflowInput
): WorkflowDefinition => {
  const parsed = workflowSchema.safeParse(definition);
  if (!parsed.success) {
    throw new Error(
      `defineWorkflow("${String(definition.key)}") isn't a valid workflow:\n${z.prettifyError(parsed.error)}`
    );
  }
  return Object.freeze(parsed.data) as WorkflowDefinition;
};
