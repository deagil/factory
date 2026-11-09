# 0046. Runs, segments and errors

- **Status:** Accepted
- **Date:** 2026-11-09
- **Amends:** [0020](0020-action-pipeline.md) (the pipeline runs at the endpoint and writes runs, not `action_log`) and [0021](0021-retry-keys-and-dry-runs.md) (a step's retry key; dry runs back example cases).

## Context

Decision [0045](0045-object-endpoints-and-workflows.md) makes every endpoint call either a generated action run as one step or a workflow of several steps, some of which pause for days or reach other systems. Phase 1's pipeline ran one action in one transaction and logged it to `action_log`. A workflow needs to say which steps commit together, what happens when a step fails after earlier ones committed, how a caller learns the outcome, and how one trace covers all of it.

## Decision

### Words

- A **run** is one call of an endpoint. A **run step** is the record of one step in it.
- A **segment** is the steps of a run that commit together.
- The **trace** is a run and its run steps.
- A **retry key** makes a repeated call or step act once.

### Segments: steps between pauses commit together

- The engine opens a transaction and runs consecutive internal steps in it. At a pause, or at an external step whose output a later step uses, it commits, checkpoints (DBOS), runs the step, checkpoints its result and opens a new transaction.
- It is automatic: nobody marks segments and the file has no setting for them. A run with no pauses is fully atomic. A later step sees an earlier one's writes. Branches cut only on the path taken. A child workflow with no pauses joins its parent's transaction.
- **External steps whose output no later step uses** (a notification email, a webhook) are queued in the segment and sent after it commits, like `event_log`, so they don't cut it and a rolled-back run sends nothing.
- Checkpoints are per segment, not per step. The editor shows where a cut may happen and the trace where it did.
- **Records can change between segments.** A later segment re-reads what it relies on with the ready-made expected-state check.

### Retry keys

- "Retry key" is the name everywhere people and agents read it. On the wire it travels in the standard `Idempotency-Key` header.
- A step's retry key is the run id plus the step id. External steps send it; `http_send` lets the workflow file name a different header when a destination needs one.
- A caller sending `Idempotency-Key` to an endpoint gets the earlier run back. The key belongs to the actor, as in decision 0021, and the index moves to `runs (actor_id, retry_key)`.

### Errors

- **In a run with no pauses,** everything rolls back and the caller gets the typed error at once: `validation`, `permission`, `not_found`, `conflict`, or the workflow's own codes such as `reason_required`. The trace is written outside the transaction, so it survives.
- **After a commit,** the failing segment rolls back and earlier segments stay. Temporary errors from external steps are retried with backoff and the same retry key. A permanent error runs the step's or segment's `on_failure` steps (for example `payment_reverse`) as a new segment.
- Validation refuses a step that can fail after a committed segment unless it has `on_failure` steps or says `on_failure: leave`. With no way out, or failing `on_failure` steps, the run is marked `needs_attention` in the inbox of the role the workflow names. Someone can retry from the failed step, run the failure steps, or mark it resolved, and each is traced.
- Nested and event-started runs carry a depth, and dispatch stops past a limit.

### What a caller gets

The endpoint waits until the run finishes or reaches its first pause; an external step is waited for up to a timeout.

- **Finished:** the output, or the typed error.
- **Still running or paused:** `202` with the run as a resource and `Location: /runs/{id}`. A run waiting for approval is that pending resource, not an `approval_required` error.

### Runs replace `action_log`

- Actions never write logs. Each step hands back its output or error, and the engine is the only writer of the trace.
- **`runs`:** one row per endpoint call: endpoint, actor, origin user, input, output or error, status, retry key, config sha, parent run, triggering event, timings.
- **`run_steps`:** one row per step: action or control, segment, input, output, error, branch taken, attempt, timings. An object endpoint call is a run with one step.
- Steps are rows, not an array on the run, so history can point at the exact step, runs can be searched by step ("failed at check_limits"), a run that waits for days isn't rewritten as it grows, and a retried step keeps its earlier attempt.
- Changed data isn't copied into steps: `audit_log` holds each field's before and after, and it and `event_log` carry `run_id` and `step_id`. Approvals point at the run (or the draft).
- The logs stay append-only. `action_log` stops being written when runs land (P2.12) and is dropped as the marked contract step when the action endpoints go (P2.26).

### Dry runs

A dry run still runs every stage and rolls back at the end, and it is the base for a workflow's example cases (decision 0045), which run in one rolled-back transaction with waits skipped and approvals and external steps faked.

## Consequences

- A workflow author never thinks about transactions; the editor and trace show the cuts the engine makes.
- A run with no pauses behaves exactly like a hand-coded route in one transaction, so most workflows need no failure handling at all.
- Steps after a pause have to cope with a world that moved on, which is why the expected-state check is ready-made and validation insists on `on_failure` or an explicit `leave`.
- The trace is the single answer to "what happened", for a one-step `PATCH` and a payment that waited a week alike.
