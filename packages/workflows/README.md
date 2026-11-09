# @workspace/workflows

Workflows: business processes as steps that run actions or control flow, started when called, by an event or on a schedule. There is no defineStep: every side effect is an action.

**Status:** definitions and validation (P2.16; decision [0048](../../docs/decisions/0048-workflow-file-format.md)). The runner comes with P2.17, events with P2.19, pauses with P2.20.

- **`workflowSchema`** is a workflow's shape: `config/workflows/<key>.yaml`, or `defineWorkflow({ … })` in TypeScript with the same keys. `input` and event payloads use the object field types (`{ type: ref, object: deal }`); `schemaOf(specs)` turns them into a Zod object.
- **`validateWorkflow(workflow, { catalog, workflows, choiceKeys })`** checks it against the system and returns `{ problems, warnings, segments }`. Each problem has a path into the file. Segments are the steps that commit together, each with the step that ends it and why.
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
