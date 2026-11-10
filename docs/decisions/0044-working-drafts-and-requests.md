# 0044. Working drafts, and requests that publish when approved

- **Status:** Accepted; amended by [0055](0055-saving-config-files-with-a-revision.md); checked against [0045](0045-object-endpoints-and-workflows.md)
- **Date:** 2026-11-08
- **Amends:** [0041](0041-drafts-over-git.md), whose drafts were opened by hand and couldn't be undone or thrown away, and [0042](0042-approval-rules.md), whose drafts were submitted, approved and then published by hand, and whose requests couldn't be withdrawn.

> **Still fits 0045.** Working drafts, revert, discard, withdraw and `approval.check` all carry over. When the draft operations become code workflows (P2.24), the parked publish is a `draft_publish` run waiting at its approval step instead of a `pending_approval` action_log row, and `approval_check` also answers for a workflow and its input.

## Context

P2.10 put drafts and approvals in the web app as their own screens: Config → Drafts to start a draft, name it and pick files to edit, then Submit, wait for an approver, come back and Publish. That is how git works, not how staff expect a system to work. They expect to change a setting where it is, see that they have edits that aren't live yet, and publish them, with approval happening along the way when a rule asks for it. And someone who asked for approval expects to be able to take the request back. The screens that do this come with P2.10b to P2.10f; this decision settles what the actions do for them.

## Decision

- **Each actor has a working draft:** its newest draft that is still open (`draft`, `valid`, `invalid` or `awaiting_approval`). `draft.mine` returns it. `draft.save` without an `id` saves into it, and opens one if there is none. A person's agent has its own. `draft.open` still starts another draft, for agents and scripts that want several.
- **A draft opened by a save is titled from its files** ("Edit deal-stages and manager"), and the title follows its files on each save (`drafts.auto_title`). `draft.open` and a `title` given to `draft.publish` name it for good.
- **`draft.revert`** puts one file back to how it was at the draft's base commit, so the draft no longer changes it. **`draft.discard`** abandons a draft and deletes its branch. Both, like a save, end a request for approval, since what was approved has changed.
- **`draft.submit` is gone; `draft.publish` asks for approval itself.** When a rule covers the draft's files and the approvals it needs aren't all given, publish asks for every sign-off, parks the same call as a `pending_approval` action_log row (`ctx.approvals.park()`), stores its id in `drafts.publish_action_id`, and returns the draft in `awaiting_approval`. It returns success, not `approval_required`, because the request is the outcome. Publishing a draft that's already waiting returns `approval_required`.
- **The last approval publishes.** `approval.approve` puts the draft back to `valid` and resumes the parked `draft.publish`, as for any pending action: as the actor who asked, after its permissions and the rules are checked again, in a savepoint. The commit is authored by that actor. If the publish fails, for example because production changed one of the draft's files, the approvals stand, the parked row is marked failed and the draft stays `valid`, so its owner can press Publish again.
- **`approval.withdraw`** takes a pending action's or a draft's id. The actor who asked, the person it acts for, or the draft's creator may withdraw it: its pending approvals are cancelled, and the pending action or the parked publish is marked with the new action status `withdrawn`. A rejection marks it `rejected`, as before.
- **`approval.check`** says beforehand what an action with an input, or a draft, would need from the caller: each rule's key, label, approver role and number of approvals. Queries get `ctx.signOffs(action, input)` from the pipeline for this, which reads a rule's record exactly as the approve stage does.
- **`approval.list` filters:** `mine` (asked by the caller, its person, or on a draft the caller began), `decidable` (pending ones the caller could decide: staff, holding the approver role, not asked by or for them, and not a subject they've already approved), and `recordId` (pending actions whose input names the record as `id`). The query is open to everyone, so requesters can follow their requests and approvers find theirs, as holding the approver role is what lets someone decide (decision 0042). Without the `approval.list` permission, a caller sees only their own requests and the ones they could decide.

## Consequences

- A request leaves two `draft.publish` rows: the call that asked, which succeeded, and the parked one, which runs or is withdrawn, rejected or failed.
- Someone holding `draft.discard` can discard another person's draft; there is no owner check yet beyond the permission.
- `recordId` only finds actions that take the record as `input.id`, which every generated update, archive and restore does. An action naming its record another way needs its own filter.
- The web app keeps its Config → Drafts screens until P2.10b and P2.10d replace them, with Submit gone and Publish, Withdraw and Discard on the draft.
