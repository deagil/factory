# 0055. Config files are saved whole, with a revision

- **Status:** Accepted
- **Date:** 2026-11-10
- **Amends:** [0041](0041-drafts-over-git.md) (a publish whose file production changed ends in "start a new draft"; a save by value rewrites the file) and [0044](0044-working-drafts-and-requests.md) (anyone who may save drafts can save into anyone's).

## Context

People and agents will change the same workflows. What exists today:

- Each actor has its own working draft, and a person's agent has a separate one (decision 0044).
- A save replaces one whole file. Nothing says which content the saver had read, so two tabs, or a person and an agent saving into the same draft by id, overwrite each other silently. The only conflict a save reports is two commits landing at the same instant.
- `draft_save` checks the caller may save drafts, not whose draft it is.
- A publish is refused if production changed one of the draft's files since the draft began, and the only way on is a new draft.
- A save by `value` writes fresh YAML, which drops comments and rewrites every line. Agents explain their workflows in comments.

The options were per-step operations ("insert a step", "move a step"), live co-editing, locks, or whole-file saves with a check that the file hasn't moved.

## Decision

- **One way to change a config file: save the whole file.** No per-step operations. They would be a second way to do the same thing, with their own rules for naming places in a file that is changing, and an agent would have to learn both.
- **A file has a revision:** an opaque string that changes when its content does (its git blob id). `draft_files` and `workflow_get` return it. `draft_save` takes it as `revision` and refuses a stale one as a `conflict`, changing nothing. It is the same idea as a record's `version`, carried in the input so HTTP and MCP behave alike. Leaving it out saves as today.
- **A save by value keeps what it didn't change.** The value is applied to the file's parsed document, so comments, key order and style survive where the content is the same, and a small change is a small diff.
- **A draft can be saved into by its creator, the creator's agents, and the person an agent's draft belongs to.** Nobody else.
- **The editor edits the person's working draft in place,** with an explicit Save. No autosave: a save is a commit, re-checks all config and withdraws a request for approval.
- **The in-app agent saves into the draft the person has open** when the page tells it which (decision [0058](0058-page-context-and-links-for-the-agent.md)). Any other agent uses its own working draft, as decision 0044 says, and the editor lists it as another draft that changes this workflow, to compare or copy from.
- **Staying current is polling.** `drafts.head_sha` records the draft's latest commit. A page asks for its draft every 15 seconds while visible and reads the file again when that changes. Unsaved edits are never replaced without asking.
- **`draft_rebase` moves a draft onto the current live config.** Files only one side changed carry over. For a file both changed, the caller picks theirs or live. Nothing merges inside a file.

## Consequences

- Losing someone's edit now takes ignoring a refusal, not bad timing.
- Choice lists and roles get revisions and kept comments from the same change.
- A person and their agent can still take turns badly: the second save is refused and has to read again. That is the intended cost of having no merge.
- Polling means up to 15 seconds before a person sees an agent's save.
- Two people building one workflow in two drafts find out when the page lists the other draft, and settle it by copying or by whoever publishes first.
- **What would change this:** people often editing one workflow at the same moment. The next step would be showing who else has it open, not merging.
