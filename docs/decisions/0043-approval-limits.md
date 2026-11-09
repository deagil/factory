# 0043. Approval limits

- **Status:** Accepted; amended by [0045](0045-object-endpoints-and-workflows.md)
- **Date:** 2026-11-08
- **Amends:** [0042](0042-approval-rules.md), whose rules asked one person, tested only the action's input and exempted only holders of the approver role.

> **Amended by 0045.** These options (approvals, requester, exempt, conditions on input and record) move to the `wait_for_approval` step. The rules that stay in `config/approvals/` cover config drafts.

## Context

Decision 0042 gave each rule one approver from one role. Real approval policies are tiered: a junior can award a small credit alone, a medium one needs a manager, a large one needs a manager and a senior, and some things need two managers. Limits often depend on a stored value, such as a payment's amount, when the action only takes the record's id. And the controls must be safe: one person must not count twice, and nobody may approve their own request, including one their agent made.

## Decision

- **`approvals: N`** (1 to 5, default 1) asks N different people with the approver role. The pipeline writes one `approvals` row per required approval, so the inbox and the schema stay as they were.
- **`requester: [roles]`** makes a rule ask only actors holding one of those roles. **`exempt: [roles]`** lists the roles whose staff skip it; by default the approver role, and `exempt: []` means nobody skips. Agents, integrations and automation never skip. Roles are flat, so tiers are written as several rules, and "this role or above" is either listing roles in `exempt` or giving senior people the lower role too.
- **Conditions read `input.…` or `record.…`.** A rule tests the record an action acts on by naming it: `record: { object: payment, id: input.id }`. The pipeline reads that record, archived or not and whatever the actor may see, since the rule is policy. Every field now starts with `input.` or `record.`. validateConfig checks the object, each record field's first segment, and every role a rule names.
- **Rules are checked again before an approved action runs.** The rules, the record or the requester's roles may change while an action waits. The pipeline works out the sign-offs the action needs at that moment, and if one isn't covered by approvals already given, it marks the action failed with `approval_required` instead of running it. `draft.publish` does the same for drafts, so a stricter rule published meanwhile also applies.
- **Who may decide.** Besides holding the role and being staff, the decider must not be the requesting actor, that actor's user, the action's origin user, or the draft's creator. They also must not have approved another row on the same subject already. So two different people approve "manager and senior" even if one person holds both roles, and nobody approves their own agent's request.

## Consequences

- Amounts are compared as stored. Money is in minor units, and a threshold needs a `currency` condition, so each currency gets its own rules. Converting currencies is out of scope.
- Tiers are separate files with hand-written boundaries, so an overlap or a gap is possible. A `tiers:` list in one rule could prevent that if files multiply.
- Approvals still happen side by side. Ordered stages, such as a manager first and then finance, aren't supported.
- A requester can't withdraw a pending request, and pending requests don't expire. Both are possible later as actions.
