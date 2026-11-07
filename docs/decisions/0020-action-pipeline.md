# 0020. How the action pipeline runs and records

- **Status:** Accepted
- **Date:** 2026-11-07

## Context

Every action runs identify, validate, retry check, authorise, approve, run, record and commit (decision 0001). `audit_log.action_id` and `event_log.action_id` reference `action_log`, so the `action_log` row must exist before the handler writes, but `actionStatuses` has no in-flight value. Failures must roll back the change yet still leave a failed row.

## Decision

- **`createPipeline({ db, config, clock, permissions?, approvals? })`** gives `run(action, input, caller)` and `query(query, input, caller)`. A caller is `{ actorId, originUserId? }`; the origin defaults to the actor's own user. Neither function throws for a failed action: both return `{ ok, … }`.
- **No in-flight status.** The `action_log` row is inserted inside the run's transaction with status `succeeded`, before the handler, and gets its `result` and `completed_at` at the record stage. Nothing outside the transaction can see it before commit, so it is never observed in flight; if the run fails, it rolls back with everything else.
- **Failures** are written as a new `failed` row in their own transaction, after the rollback, with the raw input and the error. That covers validation and permission refusals before the transaction, typed errors from the handler (returned or thrown), and unexpected errors. A matching approval rule writes a `pending_approval` row instead (phase 2 makes it resumable).
- **An unidentified caller writes nothing**: `action_log.actor_id` needs an actor. The result is a `permission` error with `actionId: null`.
- **Unexpected errors** (a thrown `Error`, or output that doesn't fit the output schema) return `{ code: "internal" }` with a generic message; the row keeps the real message.
- **Seams for later tasks.** `permissions.authorise(actor, definition)` returns a failure or null, and `permissions.canRead(actor, object)` feeds the data access layer; both allow everything until P1.11. `approvals(action, input, actor)` returns a rule key or null; nothing matches until phase 2.
- **Queries** run identify, validate, authorise and run against the database outside any transaction, and write no `action_log` row.
- **Events** are written to `event_log` at the record stage with the run's `origin_user_id` and depth 0, in the order they were emitted.

## Consequences

- An `action_log` row exists for every identified attempt, successful or not, and only successful rows have audit and event rows.
- The input is stored as the caller sent it, so a refused call is still readable.
- Retry keys and dry runs (P1.08) slot in before authorise and at the commit.
