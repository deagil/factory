# 0056. Step forms come from schemas

- **Status:** Proposed
- **Date:** 2026-11-10
- **Builds on:** [0045](0045-object-endpoints-and-workflows.md) (modules and systems add their own actions) and [0048](0048-workflow-file-format.md) (values, conditions, `fixed_inputs`).

## Context

A step runs an action, and actions come from the core, modules and each client system. An editor that needs a hand-made form per action would lag behind every new one, and a client's own actions would have no form at all. Every action already has a Zod input, which every surface reads as JSON Schema. A step's `with` is flat: each of the action's inputs gets one value, `from` a path or a fixed `value`.

## Decision

- **An action step's form is built from the action's input JSON Schema,** as `action_list` returns it (decision [0054](0054-reading-workflows-over-the-api.md)). One row per input, marked required when the schema says so.
- **Each row is one control with two modes:** a fixed value, or a value from data.
  - **From data** opens a picker that offers only what the check's scopes allow at that step: the input's or event's fields and the outputs of steps that have run on every path to it. The validator supplies the list, so the picker can't offer what a save would refuse.
  - **Fixed value** is a control chosen by the schema's type: text, number, switch, a select for `enum`, a date for a date format.
  - **An input in the action's `fixed_inputs` has only the fixed mode,** and says why: where it goes must be written in the file.
- **The fallback is a JSON box.** Objects, arrays, unions and anything else the renderer has no control for take JSON, checked against the schema. So every action can be configured with no UI code, if not always prettily.
- **Record actions use their object's fields.** `action_list` names the object a generated record action is for, and the form takes labels, choice options and record pickers from it.
- **UI hints live in the action's code, as standard JSON Schema annotations:** `title`, `description`, `examples` and `default`, set on the Zod input. They reach the form through the same schema, and MCP and OpenAPI read them too. There is no separate `hints` option on `defineAction`, and nothing about a form is ever in the workflow file.
- **The built-in steps have hand-made forms.** There are seven and nobody adds more: `if`, `wait`, `wait_for_approval`, `run`, `emit`, `fail` and `output`. `run` and `emit` reuse the schema form for the child's input and the event's payload.
- **Conditions are built, not typed:** a field from the same picker, one of the nine operators that fits the field's type, and a value control that fits it too, with a choice field's options and its columns.

## Consequences

- A module's or client's new action is usable in the editor the day it ships.
- A good form needs a good schema. An input typed as "anything" gets a JSON box, which is a nudge to type it.
- If an action needs a control the schema can't ask for (a long text box, say), the next step is one more annotation with a closed list of values, decided when an action needs it.
- The form can't be more permissive than validation or stricter than it, because both read the same schema and scopes.
