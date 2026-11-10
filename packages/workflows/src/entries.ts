// Workflows as the surfaces see them (P2.18): the entries the config loader
// keeps for each version, which HTTP, MCP, OpenAPI and `system_describe`
// read, and which hold each definition for the runner.
import type { WorkflowEntry } from "@workspace/actions";

import { fieldOf, labelFromKey, schemaOf } from "./fields.ts";
import type { WorkflowDefinition } from "./schema.ts";

/** One entry per workflow, in the order given. */
export const workflowEntries = (
  definitions: Iterable<WorkflowDefinition>
): WorkflowEntry[] =>
  [...definitions].map((workflow) => ({
    key: workflow.key,
    label: workflow.label ?? labelFromKey(workflow.key),
    description: workflow.description,
    called: workflow.starts_when === "called",
    readOnly: workflow.read_only ?? false,
    input: schemaOf(workflow.input ?? {}),
    fields: Object.entries(workflow.input ?? {}).map(([key, spec]) => ({
      key,
      label: spec.label ?? labelFromKey(key),
      field: fieldOf(spec),
    })),
    errors: workflow.errors ?? {},
    definition: workflow,
  }));

/** The definition an entry holds. */
export const definitionOf = (entry: WorkflowEntry) =>
  entry.definition as WorkflowDefinition;
