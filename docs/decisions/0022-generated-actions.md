# 0022. The shape of generated actions and queries

- **Status:** Superseded by [0045](0045-object-endpoints-and-workflows.md)
- **Date:** 2026-11-07

> **Superseded.** Generated actions become REST object endpoints (`GET /deals`, `PATCH /deals/{id}`, …) and internal record actions (`deal_get`, `deal_update`, …) that workflow steps run. Owned fields and switching jobs off go; role rules decide who writes a field. Still true: flat inputs, outputs wrapping the record, events only when something changed, and repository outcomes mapped to typed errors.

## Context

Every object gets `<object>.create`, `.update` and `.archive` actions and `.get` and `.list` queries (SYSTEM_DESIGN section 4.2). Their inputs, outputs and events are what the HTTP API, MCP tools and generated screens show, so they need one predictable shape.

## Decision

- **Inputs are flat.** `create` takes the object's create schema; `update` takes `id`, an optional `version` and any updatable fields; `archive` takes `id`. Objects with custom fields also take `customFields`. Housekeeping names (`id`, `version`) can't be field keys, so they never clash.
- **Outputs wrap the record:** `{ record }` for actions, `{ record, related }` for `get`, and the data access layer's `{ records, nextCursor, related }` for `list`, whose input is `listInputSchema(object)`.
- **Events:** `<object>.created` and `.archived` carry `{ record }`; `.updated` carries `{ record, before, after }`, the repository's changed fields. A no-op update and archiving an archived record succeed with no event, so events only mean something changed.
- **Repository outcomes become typed errors:** `not_found` → `not_found`; `conflict` (a stale `version` or a lost race) and `archived` (an update to an archived record) → `conflict`.
- **Switching off.** A job set to `false`, or owned by a hand-written action (`actions: { create: "booking.place" }`), gets no generated action. Queries are always generated. Read-only fields are already missing from `object.schemas.update`, so the generated update refuses them as unknown keys.
- `generateDefinitions(object)` returns plain definitions; `defineSystem` (P1.18) adds them to the registry with the system's own actions.

## Consequences

- Clients send `version` from the record they read to get optimistic concurrency, or leave it out to take the latest.
- Generated definitions are typed loosely (`AnyDefinition`); surfaces work from their Zod schemas, not their TypeScript types.
