# 0047. One snake_case name on every surface

- **Status:** Accepted
- **Date:** 2026-11-09
- **Supersedes:** [0028](0028-mcp-tools.md)'s mapping from dotted names to tool names.

## Context

Phase 1 named definitions with a dot and camelCase (`deal.moveStage`, `deal.stageChanged`), config keys with hyphens (`deal-stages`), and MCP tools with an underscore for the dot (`deal_moveStage`), because Claude's tool names allow only letters, digits, `_` and `-`. So one thing had up to three spellings, and people and agents had to know the mapping to search for it.

## Decision

- **Everything is snake_case,** and a thing has the same name everywhere: file, URL, MCP tool, config key, event and trace. `deal_move_stage` is `config/workflows/deal_move_stage.yaml`, `POST /workflows/deal_move_stage` and the MCP tool `deal_move_stage`; it emits `deal_stage_changed` and runs actions such as `deal_update`.
- This covers objects, fields, actions, workflows, events, roles, approval rules and choice lists (`config/choices/deal_stages.yaml`). `validateConfig` refuses other shapes.
- **Names needn't start with an object.** `month_end_close` is fine. Starting with the object a workflow acts on is a convention that groups them, not a rule.
- **Object endpoint paths use the object's plural** (`/deals`); the MCP tool uses the singular (`deal_list`).
- Actions are named as verbs and events in the past tense, as before.

## Consequences

- No mapping to learn: a name read in a trace can be pasted into a URL, a tool call or a file search.
- Field names in TypeScript are snake_case too, which reads less like ordinary TypeScript but matches the columns, the API and config.
- The rename is gradual: P2.13 renames generated actions, events and config keys; hand-written actions keep their dotted names until P2.24 and P2.25 replace them with workflows.
