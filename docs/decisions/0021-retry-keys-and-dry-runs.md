# 0021. Retry keys and dry runs

- **Status:** Accepted; amended by [0046](0046-runs-segments-and-errors.md)
- **Date:** 2026-11-07

> **Amended by 0046.** A step's retry key is the run id plus the step id; the caller's key lives on `runs (actor_id, retry_key)`. Prose says "retry key"; the wire uses `Idempotency-Key`. Dry runs are the base for a workflow's example cases.

## Context

Callers retry: a network blip, an agent repeating a tool call, a webhook delivered twice. An action sent again must not run twice. Staff and agents also need to see what an action would do before it does it. The pipeline (decision 0020) inserts the `action_log` row inside the run's transaction, which gives both a natural place to hook in.

## Decision

- **A retry key belongs to an actor.** `run(action, input, caller, { retryKey })` stores it on the `action_log` row. A partial unique index on `(actor_id, retry_key)`, over rows that `succeeded` and aren't dry runs, allows one success per key and actor.
- **The retry check** runs after validate: a success with the key returns its stored output with `replayed: true`, and the handler doesn't run. If the key was used for a different action or input, the result is a `conflict`.
- **Concurrent calls** with the same key both get past the check; the second's `action_log` insert waits on the index until the first commits, then fails with a unique violation. The pipeline catches that and replays the first's result, so the handler runs once.
- **Only successes are remembered.** A failed run writes a `failed` row, which the index ignores, so the same key can be retried after a failure. Retrying a validation error or a conflict is the common case, and a key that locked in a failure would force callers to invent a new one.
- **A dry run** (`{ dryRun: true }`) runs every stage including record, collects the run's `audit_log` rows as `changes`, then rolls the transaction back. One `action_log` row is written afterwards with `dry_run = true` and the outcome. Dry runs ignore retry keys. Ids in a dry run's output belong to records that were never kept.

## Consequences

- HTTP's `Idempotency-Key` (P1.14) and MCP tool calls can pass the key straight through.
- A replay returns the original output but not its events, which were already written once.
- Dry runs take the same locks as real runs while they last.
