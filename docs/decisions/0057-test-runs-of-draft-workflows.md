# 0057. Test runs of draft workflows

- **Status:** Proposed
- **Date:** 2026-11-10
- **Builds on:** [0045](0045-object-endpoints-and-workflows.md) (example cases, the publish gate) and [0046](0046-runs-segments-and-errors.md) (dry runs back example cases). Leaves [0041](0041-drafts-over-git.md)'s rule alone: the draft operations themselves still refuse dry runs.

## Context

Someone changing a workflow wants to try it before asking a second person to approve it. Today they can't: only published workflows can be called, the runner has no dry run, and the draft operations refuse dry runs because a push can't be rolled back. P2.22 builds a runner for example cases inside a running instance: one transaction that is always rolled back, waits skipped, approvals and external steps faked.

A test and an example case are the same thing at different ages. A case is a test someone kept.

## Decision

- **`workflow_test` runs one workflow once, as a draft or as live has it,** with a sample input or a sample event, on P2.22's runner. It is always rolled back, waits are skipped, each approval is answered as the test says, and external steps reach nothing: each returns the fake the test gives it. An external step with no fake fails the test with a message naming the step.
- **It returns what happened:** the output or the typed error, each step with its input, output, error, branch and segment, and the record changes and events it would have written.
- **The trace is kept as a dry run:** a `runs` row with `dry_run` set and the draft's commit as its `config_sha`, with its steps. So a test can be opened in Activity like any run, and who tested what is on record. Its changes and events are not kept, because they never happened.
- **The result also comes back as an example case,** in P2.22's shape: the caller, the input or event, the fakes, and what came out. Keeping it is adding it to the file's `cases` and saving, an ordinary `draft_save`. There is no separate "save as case" operation.
- **It is granted by name, and the grant is a serious one.** A test runs under the service key against real records, so its step outputs can show the tester data their own roles hide, from a workflow nobody has approved. Roles that may test should be few.
- **The caller can be chosen,** as a case's can, so "what happens when sales calls this" can be tried. It changes who the run records as origin user and what ownership checks see; it never widens what the tester may do.

## Consequences

- An agent can build, check, test and submit a workflow through four operations, and a person can do the same on one page.
- The first failing test of a declared error is one click from being the failing case the publish gate asks for.
- Dry runs from tests appear in Activity → Workflow runs. They are marked as tests, as dry runs are today.
- A test sees real data but changes none of it. Running tests only against fixture records would be safer and is much more to build; it is the next step if testing is given to many people.
- A test of a draft is pinned to that draft's commit. Once the draft is published or discarded its branch goes, so a link from an old test's trace back to the definition may find nothing and falls back to live.
- This depends on P2.22. Until then the editor has no Test tab.
