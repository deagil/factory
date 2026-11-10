// `action_list` and `event_list`: two read-only code workflows. Each is one
// step that runs a read-only internal action. `defineSystem` adds both.
import { defineAction } from "@workspace/actions";
import type { AnyActionDefinition, AnyDefinition } from "@workspace/actions";
import type { AnyObjectDefinition } from "@workspace/objects";
import { defineWorkflow } from "@workspace/workflows";
import type { WorkflowDefinition } from "@workspace/workflows";
import { z } from "zod";

import { collectEvents, listStepActions } from "./action-events.ts";

const jsonSchema = z.record(z.string(), z.unknown());

const actionRow = z.strictObject({
  name: z.string(),
  description: z.string(),
  kind: z.enum(["internal", "external"]),
  input: jsonSchema,
  output: jsonSchema,
  errors: z.record(z.string(), z.string()),
  emits: z.array(z.string()),
  read_only: z.literal(true).optional(),
  fixed_inputs: z.array(z.string()).optional(),
  object: z.string().optional(),
});

const eventRow = z.strictObject({
  type: z.string(),
  payload: z.discriminatedUnion("kind", [
    z.strictObject({
      kind: z.literal("fields"),
      fields: z.record(z.string(), z.record(z.string(), z.unknown())),
    }),
    z.strictObject({
      kind: z.literal("schema"),
      schema: jsonSchema,
    }),
  ]),
  from: z.strictObject({
    kind: z.enum(["object", "action", "workflow"]),
    name: z.string(),
  }),
  workflows: z.array(z.string()),
});

export interface ActionEventDeps {
  readonly objects: readonly AnyObjectDefinition[];
  readonly steps: ReadonlyMap<string, AnyActionDefinition>;
  readonly definitions: () => readonly AnyDefinition[];
  readonly codeWorkflows: ReadonlyMap<string, WorkflowDefinition>;
}

/** The two actions the workflows' steps run. They read `deps` when called. */
export const actionEventStepActions = (
  deps: ActionEventDeps
): AnyActionDefinition[] => [
  defineAction({
    name: "list_step_actions",
    kind: "internal",
    readOnly: true,
    description:
      "The actions a workflow step can run, with their schemas, errors and the object a record action is for.",
    input: z.strictObject({}),
    output: z.strictObject({ actions: z.array(actionRow) }),
    handler: () => ({ actions: listStepActions(deps.steps, deps.objects) }),
  }),
  defineAction({
    name: "list_events",
    kind: "internal",
    readOnly: true,
    description:
      "Every event, its payload, where it comes from and the workflows it starts. A draft id reads that draft's workflows instead of the live ones.",
    input: z.strictObject({ draft_id: z.uuid().optional() }),
    output: z.strictObject({ events: z.array(eventRow) }),
    handler: async (ctx, input) => {
      const found = await collectEvents(ctx, input, {
        objects: deps.objects,
        definitions: deps.definitions(),
        steps: deps.steps,
        codeWorkflows: deps.codeWorkflows,
      });
      if (!found.ok) {
        switch (found.code) {
          case "validation": {
            return ctx.invalid(found.message);
          }
          case "not_found": {
            return ctx.notFound("draft", found.id);
          }
          default: {
            const unexpected: never = found;
            throw new Error(
              `Unexpected event list result: ${JSON.stringify(unexpected)}`
            );
          }
        }
      }
      return { events: found.events };
    },
  }),
];

export const actionEventWorkflows: readonly WorkflowDefinition[] = [
  defineWorkflow({
    key: "action_list",
    label: "Actions",
    description:
      "The actions a workflow step can run, with their kind, schemas, errors, whether they only read, which inputs are fixed, and the object a record action is for.",
    starts_when: "called",
    read_only: true,
    output: { actions: { from: "steps.list.output.actions" } },
    steps: [{ id: "list", action: "list_step_actions" }],
  }),
  defineWorkflow({
    key: "event_list",
    label: "Events",
    description:
      "Every event: its payload, where it comes from, and the workflows it starts. Give a draft id to read that draft's workflows instead of the live ones.",
    starts_when: "called",
    read_only: true,
    input: {
      draft_id: {
        type: "text",
        optional: true,
        label: "Draft",
        description: "Read this draft's workflows instead of the live ones.",
      },
    },
    output: { events: { from: "steps.list.output.events" } },
    steps: [
      {
        id: "list",
        action: "list_events",
        with: { draft_id: { from: "input.draft_id" } },
      },
    ],
  }),
];
