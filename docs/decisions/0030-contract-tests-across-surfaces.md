# 0030. Contract tests across surfaces

- **Status:** Accepted
- **Date:** 2026-11-07

## Context

Every action is reachable over HTTP (decision 0027) and as an MCP tool (decision 0028). They must behave the same: the same result for the same input, and the same rows in `action_log`, `audit_log` and `event_log`. A surface that quietly differs breaks the promise that every change is logged the same way, whoever makes it.

## Decision

- **`runContract({ registry, objects, pipeline, db, caller, surfaces, samples })`** in `@workspace/server/testing` runs every registered action on every surface, one after another, twice: with a sample input and with `{}`. It compares what the client got and the log rows the call wrote, after replacing ids, times and API keys with placeholders. It returns the differences; a test expects none.
- **Samples:** generated create, update and archive actions get theirs from their fields (refs are filled by creating the target first). Hand-written actions need a sample in `samples`; an action with none is reported, so a new action can't skip the contract.
- **Surfaces** are functions from an action and input to `{ ok, body, actionId }`. `httpSurface` and `mcpSurface` wrap an app's `request`.
- **MCP results carry the `action_log` id** in `_meta.actionId`, so clients and the contract can find the row.
- **Only the pipeline validates input.** The MCP SDK validated tool arguments itself, so a bad call over MCP got the SDK's error and no log row, unlike HTTP. The contract test found this. Tools now advertise the definition's JSON Schema with a validator that accepts anything.

## Consequences

- A system built on factory (the CRM in P1.18) runs `runContract` on its own registry in CI.
- The contract runs on a real database and takes about a second for the CRM fixture; it grows with the number of actions.
- Queries aren't in the contract yet; they write no log rows, and both surfaces call the same `pipeline.query`.
