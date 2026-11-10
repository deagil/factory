# 0054. Reading workflows over the API

- **Status:** Accepted
- **Date:** 2026-11-10
- **Builds on:** [0045](0045-object-endpoints-and-workflows.md) (reads are read-only code workflows; agents build workflows through the endpoints the web app uses), [0048](0048-workflow-file-format.md) (validation and segments) and [0029](0029-system-describe.md), which stays as it is.

## Context

A caller can read very little of a workflow today:

- `system_describe` lists only the workflows the caller may call, with their input and errors. It never gives the steps, and it leaves out workflows an event or a schedule starts (`packages/actions/src/describe.ts`).
- The actions a step can run are listed only in a whole system's description, which `fx describe` prints. No endpoint returns them.
- `validateWorkflow` returns problems, warnings and segments, but a caller sees only a saved draft's problems. Checking a file means saving it.
- Nothing lists a config file's published versions. `GitService` has no log.

An agent building a workflow needs all of these as much as a screen does. Decision 0048 already named `workflow_validate` as the operation that shows where segments cut.

## Decision

- **Six read-only code workflows,** each one step running a read-only internal action, so each is an endpoint, an MCP tool of the same name and an OpenAPI operation:
  - **`workflow_list`:** every workflow, in code and config, with what starts it, the events it emits, the workflows it runs and its counts of problems and warnings.
  - **`workflow_get`:** one workflow as live, a draft or a past commit has it: the definition, its YAML, its revision (decision [0055](0055-saving-config-files-with-a-revision.md)), whether it can be edited and why not, and its check.
  - **`workflow_validate`:** checks a value or YAML without saving, against a draft's other files or live. It returns the same check, and the value and YAML each way.
  - **`action_list`:** the actions steps can run, with kind, schemas, errors, `read_only` and `fixed_inputs`.
  - **`event_list`:** every event, its payload, where it comes from and the workflows it starts.
  - **`config_history`:** the published commits that changed one config file. It is for any config type, not only workflows.
- **The check gains scopes.** For each step, `validateWorkflow` also returns which steps' outputs it may read, with each step's output schema once, and the input's or event's fields described as `system_describe` describes fields. An editor's data picker and the validator are then the same rule, written once.
- **They are granted by name,** in a role's `workflows`, like any workflow. Nobody reads definitions by default.
- **They take a `draft_id`, never "mine".** A step's action runs under the service key and knows the origin user, not the calling actor.
- **`system_describe` doesn't change.** It still means "what you may call". These operations appear in it for callers whose roles name them, because they are workflows.
- **Code workflows are returned too,** marked `source: code` and not editable, with YAML made from the definition so every workflow reads the same way.

## Consequences

- An agent can read a workflow, check a change and see what a step may read without saving anything.
- The Automation pages can list what really exists. Today Automation → Actions shows the caller's callable actions, which go away with P2.26.
- A role that may read workflows sees how every process works, including which roles approve what. That is why it is a grant.
- These are the core's first code workflows, ahead of P2.24. Their outputs have no schema in OpenAPI or MCP, since a workflow's `output` is a mapping, not a typed schema; P2.24 has the same gap for every core operation and should close it once for all.
- A draft or a past commit is read through the config remote, so those inputs are refused on a system that reads `config/` from its working tree.
