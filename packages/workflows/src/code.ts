// The core's code workflows. Each operation is one read-only internal
// action and a workflow of the same name whose single step runs it.
// defineSystem registers both on every system. A later operation is another
// pair here: the action reads only through its context, and the workflow is
// read_only when it never writes.
import { defineAction } from "@workspace/actions";
import type {
  ActionContext,
  AnyActionDefinition,
  AnyDefinition,
} from "@workspace/actions";
import type { AnyObjectDefinition } from "@workspace/objects";
import { z } from "zod";

import { collectEvents, listStepActions } from "./action-events.ts";
import { defineWorkflow } from "./define-workflow.ts";
import {
  getWorkflow,
  listWorkflows,
  workflowGetOutput,
  workflowListOutput,
} from "./reading.ts";
import type { WorkflowReadContext } from "./reading.ts";
import type { WorkflowDefinition } from "./schema.ts";

const snake = /^[a-z][a-z0-9]*(?:_[a-z0-9]+)*$/u;
const sha = z.string().regex(/^[0-9a-f]{40}$/u, "A sha is 40 hex characters.");

const draftField = {
  type: "text" as const,
  optional: true,
  label: "Draft",
  description: "Read the workflows as this draft has them.",
};

const adapt = (ctx: ActionContext): WorkflowReadContext => ({
  config: ctx.config,
  git: ctx.git,
  draft: (id) => ctx.dal.draftDetail(id),
  actor: async (id) => {
    const row = await ctx.identity.getActor(id);
    return row ? { id: row.id, name: row.name } : null;
  },
  invalid: (message) => ctx.invalid(message),
  notFound: (object, id) => ctx.notFound(object, id),
});

const workflowList = defineAction({
  name: "workflow_list",
  kind: "internal",
  readOnly: true,
  description:
    "Every workflow, in code and in config, with what starts it, what it emits and runs, and how many problems and warnings it has.",
  input: z.strictObject({ draft_id: z.uuid().optional() }),
  output: workflowListOutput,
  handler: (ctx, input) => listWorkflows(adapt(ctx), input),
});

const workflowGet = defineAction({
  name: "workflow_get",
  kind: "internal",
  readOnly: true,
  description:
    "One workflow as it is live, in a draft, or at a past commit: its definition, its YAML, its revision, whether it can be edited, and its check.",
  input: z.strictObject({
    key: z.string().regex(snake),
    draft_id: z.uuid().optional(),
    sha: sha.optional(),
  }),
  output: workflowGetOutput,
  handler: (ctx, input) => getWorkflow(adapt(ctx), input),
});

const readWorkflow = (
  key: string,
  description: string,
  input: NonNullable<Parameters<typeof defineWorkflow>[0]["input"]>,
  output: z.ZodObject
) =>
  defineWorkflow({
    key,
    description,
    starts_when: "called",
    read_only: true,
    input,
    output: Object.fromEntries(
      Object.keys(output.shape).map((name) => [
        name,
        { from: `steps.read.output.${name}` },
      ])
    ),
    steps: [
      {
        id: "read",
        action: key,
        with: Object.fromEntries(
          Object.keys(input).map((name) => [name, { from: `input.${name}` }])
        ),
      },
    ],
  });

const workflowListWorkflow = readWorkflow(
  workflowList.name,
  workflowList.description,
  { draft_id: draftField },
  workflowListOutput
);

const workflowGetWorkflow = readWorkflow(
  workflowGet.name,
  workflowGet.description,
  {
    key: {
      type: "text",
      label: "Key",
      description: "The workflow's key.",
    },
    draft_id: draftField,
    sha: {
      type: "text",
      optional: true,
      label: "Version",
      description:
        "A past commit. Leave it out for live, or give a draft instead.",
    },
  },
  workflowGetOutput
);

const jsonSchema = z.record(z.string(), z.unknown());

const actionListOutput = z.strictObject({
  actions: z.array(
    z.strictObject({
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
    })
  ),
});

const eventListOutput = z.strictObject({
  events: z.array(
    z.strictObject({
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
    })
  ),
});

const actionListWorkflow = readWorkflow(
  "action_list",
  "The actions a workflow step can run, with their schemas, errors and the object a record action is for.",
  {},
  actionListOutput
);

const eventListWorkflow = readWorkflow(
  "event_list",
  "Every event, its payload, where it comes from and the workflows it starts. A draft id reads that draft's workflows instead of the live ones.",
  { draft_id: draftField },
  eventListOutput
);

/** What the actions that list a system's own steps and events close over. */
export interface CoreStepParts {
  readonly objects: readonly AnyObjectDefinition[];
  readonly steps: ReadonlyMap<string, AnyActionDefinition>;
  readonly definitions: () => readonly AnyDefinition[];
  readonly codeWorkflows: ReadonlyMap<string, WorkflowDefinition>;
}

/** `action_list` and `event_list` read the system they are registered on. */
const editorActions = (parts: CoreStepParts): AnyActionDefinition[] => [
  defineAction({
    name: "action_list",
    kind: "internal",
    readOnly: true,
    description: actionListWorkflow.description,
    input: z.strictObject({}),
    output: actionListOutput,
    handler: () => ({ actions: listStepActions(parts.steps, parts.objects) }),
  }),
  defineAction({
    name: "event_list",
    kind: "internal",
    readOnly: true,
    description: eventListWorkflow.description,
    input: z.strictObject({ draft_id: z.uuid().optional() }),
    output: eventListOutput,
    handler: async (ctx, input) => {
      const found = await collectEvents(ctx, input, {
        objects: parts.objects,
        definitions: parts.definitions(),
        steps: parts.steps,
        codeWorkflows: parts.codeWorkflows,
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

/** The actions the core's code workflows run. None is on a surface. */
export const coreWorkflowActions = [workflowList, workflowGet];

/**
 * Every action a core code workflow runs, including the ones that read the
 * system they belong to. `defineSystem` adds these and `coreWorkflows`.
 */
export const coreStepActions = (
  parts: CoreStepParts
): AnyActionDefinition[] => [...coreWorkflowActions, ...editorActions(parts)];

/** The core's code workflows, one step each. */
export const coreWorkflows = [
  workflowListWorkflow,
  workflowGetWorkflow,
  actionListWorkflow,
  eventListWorkflow,
];
