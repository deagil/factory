// Workflows as the surfaces see them (P2.18): the entries the config loader
// keeps for each version, which HTTP, MCP, OpenAPI and `system_describe`
// read, and which hold each definition for the runner.
import type { WorkflowEntry } from "@workspace/actions";

import { fieldOf, schemaOf } from "./fields.ts";
import type { WorkflowDefinition } from "./schema.ts";

/** `deal_move_stage` → "Deal move stage", for a workflow with no label. */
const labelOf = (key: string) => {
  const words = key.replaceAll("_", " ");
  return words.charAt(0).toUpperCase() + words.slice(1);
};

/** One entry per workflow, in the order given. */
export const workflowEntries = (
  definitions: Iterable<WorkflowDefinition>
): WorkflowEntry[] =>
  [...definitions].map((workflow) => ({
    key: workflow.key,
    label: workflow.label ?? labelOf(workflow.key),
    description: workflow.description,
    called: workflow.starts_when === "called",
    readOnly: workflow.read_only ?? false,
    input: schemaOf(workflow.input ?? {}),
    fields: Object.entries(workflow.input ?? {}).map(([key, spec]) => ({
      key,
      label: spec.label ?? labelOf(key),
      field: fieldOf(spec),
    })),
    errors: workflow.errors ?? {},
    definition: workflow,
  }));

/** The definition an entry holds. */
export const definitionOf = (entry: WorkflowEntry) =>
  entry.definition as WorkflowDefinition;
