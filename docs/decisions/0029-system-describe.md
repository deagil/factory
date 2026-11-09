# 0029. `system.describe`

- **Status:** Accepted; amended by [0045](0045-object-endpoints-and-workflows.md)
- **Date:** 2026-11-07

> **Amended by 0045.** `system_describe` lists object endpoints and the workflows the caller may call, with each field's read and write for the caller; actions are not listed on it. It becomes a read-only code workflow.

## Context

The web app builds its screens from the system, and agents need to understand it before acting. Both need the objects, fields, actions, queries and events, with schemas, but only what the caller may use. A caller with no permissions at all still needs to ask.

## Decision

- **`describeQuery({ objects, definitions })`** in `@workspace/actions` makes the `system.describe` query. It adds itself to the definitions it describes. It returns:
  - `objects`: name, label, description, list fields, whether it has custom fields, and each field's key, label, type, required, read-only (owned by a hand-written action), `ref` target, filter operators and input JSON Schema.
  - `actions` (with the events each emits) and `queries`, with input and output JSON Schemas.
  - `events` emitted by the actions listed, with payload JSON Schemas.
- **Filtering:** an object is listed if the caller can view it; an action or query if the caller is authorised to run it; an event if a listed action emits it.
- **`ctx.granted`** gives query and action handlers the caller's granted set, so a handler can filter by permission. It's the same `Granted` the pipeline authorises with.
- **`everyone: true`** on a query skips the permission check. It's only for queries that filter their own result by `ctx.granted`; `system.describe` is the first.

## Consequences

- An actor with no roles sees only `system.describe` itself.
- The JSON Schemas are standalone (`$defs` and refs stay inside each schema); the OpenAPI document hoists them instead (decision 0027).
- A snapshot test of the CRM fixture's description catches unintended changes to any schema, so a deliberate change means updating the snapshot.
- `defineSystem` (P1.18) adds `system.describe` to every system.
