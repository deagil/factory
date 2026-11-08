# 0042. Approval rules

- **Status:** Accepted
- **Date:** 2026-11-08
- **Amends:** [0020](0020-action-pipeline.md), whose pipeline took an `approvals` function that returned a rule key, and SYSTEM_DESIGN §3's `approvals` and `approval_decisions` tables.

## Context

SYSTEM_DESIGN §4.2 has the pipeline's approve stage park an action that an approval rule matches, and §4.4 has a draft wait for approval when a rule covers its files. Decision 0020 left a seam, a function returning a rule key, and wrote a `pending_approval` row that nothing could resume. P2.09 had to settle what a rule looks like, who it applies to, who may decide, and how an approved action runs exactly once.

## Decision

- **A rule is config, `config/approvals/<key>.yaml`:** a key, a label, an optional description and an `approver` role, and either an `action` with optional `when` conditions or `config`, a list of config types. A condition is `field` (a path into the action's input), `operator` (`eq`, `ne`, `in`, `notIn`, `gt`, `gte`, `lt`, `lte`) and `value`; every condition must hold. There are no expressions. validateConfig checks the action (generated ones included), the config types and the role exist.
- **A rule doesn't apply to staff who hold its approver role,** since they could approve it themselves. Agents, integrations and automation always need a person, even an agent acting for an approver.
- **The pipeline reads the rules from `ctx.config.approvals`,** pinned with the rest of the run's config, after authorise. A matching action gets a `pending_approval` action_log row and one `approvals` row per matching rule, in one transaction, and the caller gets `approval_required` with the action id. A dry run only reports it. The `approvals` option of `createPipeline` is gone; an `actions` lookup takes its place, so the pipeline can find a pending action's definition.
- **`approval.approve` and `approval.reject` are open to every actor; the handler checks the decider.** The decider must be staff, hold the approval's role (copied onto the row when it was asked for) and not be the actor who asked. One decision closes an approval; the `approvals` row keeps who decided, when and their comment, so there is no `approval_decisions` table. `approval.list` is the inbox.
- **The last approval runs the action in the same transaction, once.** The approve action locks the subject's row first, so decisions on one subject happen one at a time. The pending action runs as the actor who asked, with its origin user, after its input and permissions are checked again, inside a savepoint. Its action_log row becomes `succeeded` or `failed`, and its record changes and events carry that row's id, so action_log has the requester on the action and the approver on `approval.approve`. A failure rolls back only the savepoint: the approval stands and the action is marked failed. A rejection cancels the other pending approvals and marks the action `rejected`.
- **Drafts:** `draft.submit` asks for the sign-offs the rules covering the draft's files need, and the draft waits in `awaiting_approval`. Once every one is approved the draft is `valid` again and `draft.publish` checks an approved row exists for each rule that applies to the publisher. Saving a draft cancels its approvals, since what they approved has changed. A rejection puts the draft back to `valid`, to change and submit again.

## Consequences

- An approver role needs no extra permission to approve; holding the role is the permission.
- Conditions test the action's input only. Testing a choice field's column, such as `stage.category`, needs to know which input field is which list; that comes with workflow conditions (P2.11), which test event payloads.
- One approval per rule; a rule can't yet ask for two approvers.
- A retry of a parked action with the same retry key parks a second one; retry keys only replay successes.
- Workflow steps whose action needs approval (§4.6) will wait on these rows durably in P2.12.
