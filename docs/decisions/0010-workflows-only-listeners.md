# 0010. Workflows are the only listeners; every side effect is an action

- **Status:** Accepted
- **Date:** 2026-11-06

## Context

Earlier designs had several ways to react to an event: webhook endpoints with their own delivery table, code-level event handlers, and workflow steps written in code with `defineStep`. Each was a separate place to look when asking "what happens when a booking is cancelled?", and each had its own retry, logging and permission story. Steps written in code could also do things that no action covered, so some side effects were neither permission-checked nor in `action_log`.

## Decision

- **Events are declared on actions** (`emits`), with a payload schema, and live in code. Actions are named as verbs; events in the past tense.
- **Workflows are the only listeners.** A workflow is triggered by an event, a schedule or a manual start. By convention there is one workflow per event.
- **Every side effect is an action,** including `comms.send` and `http.send`. A workflow step either runs an action or is control flow (`condition`, `wait`, `waitForApproval`). There is no `defineStep`.
- **Calling an outside system is an `http.send` step** with a fixed URL, signed payload, retries and per-step `onFailure` (default `continue`). A "webhook" is just a one-step workflow.
- **No webhook tables.** Outbound deliveries are recorded in `workflow_runs` and `workflow_step_runs`. Inbound webhooks are HTTP routes mapped to actions, run as integration actors, with the provider's event ID as the retry key.
- **One dispatcher** starts one DBOS run per (event, workflow) pair, with a depth limit on chains.
- **Rule of thumb:** what must happen atomically with the change goes in the action (code); what follows it goes in a workflow (config).

## Consequences

- One place to look for behaviour: the workflows for that event, grouped in a "What happens when…" view per object.
- Every side effect gets the full action pipeline: permissions, approvals, retry keys, dry run and `action_log`.
- Fewer tables and one delivery mechanism to build and operate.
- New kinds of side effect need an action first. That is more work than a quick step, but it keeps agents, staff and workflows on the same capabilities.
- Workflow files can become long; splitting by failure handling is allowed but should be rare.
