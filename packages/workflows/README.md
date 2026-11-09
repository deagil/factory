# @workspace/workflows

Workflows: business processes as steps that run actions or control flow, started when called, by an event or on a schedule. There is no defineStep: every side effect is an action.

**Status:** definitions and validation (P2.16; decision [0048](../../docs/decisions/0048-workflow-file-format.md)) the runner for runs with no pauses (P2.17), and entries for the surfaces (P2.18: `workflowEntries`, which `@workspace/server` serves at `/workflows/<key>` and as MCP tools). Events come with P2.19, pauses and external steps with P2.20.

- **`workflowSchema`** is a workflow's shape: `config/workflows/<key>.yaml`, or `defineWorkflow({ … })` in TypeScript with the same keys. `input` and event payloads use the object field types (`{ type: ref, object: deal }`); `schemaOf(specs)` turns them into a Zod object.
- **`validateWorkflow(workflow, { catalog, workflows, choiceKeys })`** checks it against the system and returns `{ problems, warnings, segments }`. Each problem has a path into the file. Segments are the steps that commit together, each with the step that ends it and why.
- **`createRunner({ db, actions, clock })`** gives `run(workflow, input, { originUserId, config, workflows })`, which runs a workflow with no pauses in one transaction under the service key, and `actorOf(key)`, the workflow's automation actor. Action steps go through `runInternalStep`; `if` takes a branch; `run` runs a nested workflow as a child run in the same transaction; `emit` checks the payload against the declared event; `fail` and `output` end the run. It returns `{ ok, runId, output }` or `{ ok: false, runId, error }`, and any failure rolls everything back. The run and each action step are inserted as they start, since history points at them; the other steps and the events are written once as the transaction ends; after a rollback the runs and steps are written again, so a failed run keeps its trace.
- **`workflowConfigType`** registers `config/workflows`: its references are the roles it names, and its `check` is `validateWorkflow`, so `validateConfig` reports problems with file and line. `@workspace/server` adds it to the core's config types, validates code workflows in `defineSystem({ workflows })`, and lists every workflow with its segments in `fx describe`.

```ts
import { defineWorkflow } from "@workspace/workflows";

export const organisationArchive = defineWorkflow({
  key: "organisation_archive",
  description: "Archive an organisation once an admin agrees.",
  starts_when: "called",
  input: { organisation: { type: "ref", object: "organisation" } },
  attention_role: "admin",
  steps: [
    { id: "ask", wait_for_approval: { approver: "admin" } },
    {
      id: "archive",
      action: "organisation_archive",
      with: { id: { from: "input.organisation" } },
    },
  ],
});
```

Design: [docs/SYSTEM_DESIGN.md](../../docs/SYSTEM_DESIGN.md), section 4.6 Workflows.
