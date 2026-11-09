# 0048. The workflow file and its validation

- **Status:** Accepted
- **Date:** 2026-11-09
- **Builds on:** [0045](0045-object-endpoints-and-workflows.md) (workflows, the publish gate) and [0046](0046-runs-segments-and-errors.md) (segments, `on_failure`).

## Context

Decision 0045 sketched a workflow file and left its exact format to P2.16. The format has to suit people reading a YAML file, agents writing one, and the core writing the same shape in TypeScript. Validation has to catch the mistakes that would otherwise surface only when a run fails: a step given the wrong type, a value read from a step that may not have run, a step that fails after a commit with no way out, and a URL taken from data.

## Decision

**The file.** `config/workflows/<key>.yaml`, or `defineWorkflow({ … })` in TypeScript, in the same shape with the same snake_case keys:

- `key` (the file name, as every config file has), optional `label` (its button), `description`, `starts_when`, optional `read_only`, `input`, `output`, `errors`, `events`, `attention_role`, `on_failure` and `cases`, and `steps`.
- `starts_when` is `called`, `{ event: <name>, when: [conditions] }` or `{ schedule: "<five cron fields>" }`. Only a called workflow takes `input`; an event-started one reads `event.…`.
- `input` and each event's payload use the object field types: `{ type: text | number | money | date | boolean | ref | choice, … }`, with each type's options in snake_case (`max_length`). A field is required unless `optional: true`, like a function's parameters. Each becomes the object field of that type, so its values are checked the same way.
- A **value** is `{ from: <path> }` or `{ value: <fixed> }`. Paths are `input.<field>`, `event.<field>` and `steps.<id>.output.<field>`, with any path below. A choice field's path can name a column of its option, such as `input.stage.category`.
- A **condition** is a field and one operator: `is`, `is_not`, `one_of`, `not_one_of`, `above`, `at_least`, `below`, `at_most`, or `empty: true | false`. An `if` holds when all of its conditions do. The same operators as the `record_in_state` check; approval rule files keep theirs until P2.21 moves rules to steps.
- A **step** is exactly one of `action` (with `with`), `if` (with `then` and optional `else`), `wait` (`for: 3d` or `until: <value>`), `wait_for_approval` (approver, approvals, requester, exempt, `when`, message), `run` (another workflow, with `with`), `emit` (with `with`), `fail` (one of the workflow's errors, with an optional message) or `output` (ends the run with the workflow's output). Every step has an `id`, unique in the workflow, except `fail` and `output`, which end the run.
- **`on_failure`** is a list of steps or `leave`, on a step (and for an `if`, what is inside it) or on the workflow, covering every step without its own.
- A workflow may `emit` an event it declares under `events`, or one already in the system. Declaring an event that already exists is refused: one event, one schema.
- `cases` are accepted with a `name` and anything else until P2.22 settles them.

**Actions say two more things.** `defineAction` takes `readOnly` (it only reads; the generated get and list and the checks are) and `fixedInputs` (inputs a workflow must set with a fixed `value`, such as `http_send`'s `url`). Validation uses both.

**Validation** (`validateWorkflow`) checks:

- the actions, workflows, events, objects and choice lists it names exist, and condition values fit their fields (a choice's option key exists, a column's value is one it allows);
- each step's `with` gives what the action, workflow or event needs, nothing it doesn't take, and values whose JSON type matches. Types compare loosely: a whole number fits a number, and anything whose type can't be told fits anything. JSON Schema is the common form, as `system_describe` already gives agents;
- each `from` reads a step that has run on every path to it;
- a fixed input never comes `from` data;
- a step that can fail (an action, a `run`, a rejected approval, a `fail`) after a change may have committed has `on_failure`, its own or an enclosing one. A change counts as committed once a segment that wrote has ended; reads alone don't need a way out;
- a workflow that may commit before its end names `attention_role`;
- a `read_only` workflow is called and runs only read-only actions and read-only workflows, with no emit or waits;
- nothing follows a step that ends every path.

It **warns**, without refusing, when the input takes the id of an object that has an owner and no `record_belongs_to_caller` step checks it.

It returns the **segments**: the steps that commit together, and for each, the step that ends it and why (a wait, an approval, an external action whose output a later step reads, or a child workflow that may pause), marked conditional when it is in a branch. An external action whose output nothing reads is listed as queued after its segment.

**Where it runs.** A config type may now have a `check` beyond its references; the `workflows` type's check is `validateWorkflow`, so problems come with file and line from `validateConfig`, the loader and draft saves. Code workflows are validated when `defineSystem` builds the system, which refuses one that doesn't line up; a code workflow may run only other code workflows. `fx describe` lists every workflow with its segments, problems and warnings.

## Consequences

- One shape for YAML and TypeScript, so the core's operations (P2.24) and client processes read alike, and an agent can learn one format.
- `key` rather than the sketch's `name` keeps every config file alike, at the cost of workflows differing from objects and actions, which say `name`.
- Loose type matching can pass a value that fails at run time (a text to a uuid input, a null to a required one); the example cases (P2.22) catch those.
- Validation follows only the branches and step order, not values, so it can ask for an `on_failure` a run would never need. `on_failure: leave` is the explicit answer.
