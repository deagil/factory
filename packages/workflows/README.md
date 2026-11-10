# @workspace/workflows

Workflows: business processes as steps that run actions or control flow, started when called, by an event or on a schedule. There is no defineStep: every side effect is an action.

**Status:** definitions and validation (P2.16; decision [0048](../../docs/decisions/0048-workflow-file-format.md)), the runner (P2.17), entries for the surfaces (P2.18: `workflowEntries`, which `@workspace/server` serves at `/workflows/<key>` and as MCP tools), and durable runs (P2.20). Events and schedules are started by `@workspace/events` (P2.19). Approvals come with P2.21.

- **`workflowSchema`** is a workflow's shape: `config/workflows/<key>.yaml`, or `defineWorkflow({ … })` in TypeScript with the same keys. `input` and event payloads use the object field types (`{ type: ref, object: deal }`); `schemaOf(specs)` turns them into a Zod object.
- **`validateWorkflow(workflow, { catalog, workflows, choiceKeys })`** checks it against the system and returns `{ problems, warnings, segments }`. Each problem has a path into the file. Segments are the steps that commit together, each with the step that ends it and why.
- **`createRunner({ db, actions, clock, git, durable })`** gives `run`, `actorOf`, `attend`, `start` and `stop`. `git` is the config remote, which a step's action reads as `ctx.git`. A workflow with no pauses and no external steps runs in one transaction under the service key. One that waits, or runs an external action, is a DBOS workflow on `durable.databaseUrl`: each segment commits and is checkpointed, then the wait, the external step or the child run happens outside the transaction. An external step whose output a later step reads ends the segment; one whose output nothing reads is sent only after the segment commits. `unavailable` is tried again with backoff, always with the retry key `<run id>:<step id>`. A failure after a commit rolls back that segment and runs the covering `on_failure` steps, or marks the run `needs_attention`. `attend` retries it, runs those steps, or marks it `resolved`. `run` returns `{ ok, runId, output }`, `{ ok: false, runId, error }`, or `{ ok: true, runId, pending: true, status }` when the run is still going. The caller of an endpoint gets `202` and `Location: /runs/{id}` for that last one. The run and each action step are inserted as they start, since history points at them; the other steps and the events are written once as the segment's transaction ends; after a rollback the trace is written again, with a `rolled_back` step when an earlier segment had already committed.
- **Code workflows** live in `src/code.ts`: one read-only internal action and a `defineWorkflow` of the same name whose one step runs it. `defineSystem` registers both, so every system has them and a role grants them by name. A new core operation is another pair there.
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
