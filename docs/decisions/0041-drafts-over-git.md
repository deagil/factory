# 0041. Drafts over git

- **Status:** Accepted
- **Date:** 2026-11-08

## Context

SYSTEM_DESIGN §4.4 has staff change config in drafts that publish as one git commit, which a bot copies back to `main`, and the running system loads within seconds. Phase 2 decided the config remote is any git remote, used through plain git commands, and that the bot is a function the config service calls after the merge (phase 2 plan). P2.08 had to settle the details: how drafts are named and stored, what "merges into production in one commit" means, what happens when production or `main` moved, and how the loader reads a remote.

## Decision

- **The actions are `draft.open`, `draft.save`, `draft.submit` and `draft.publish`, and the queries `draft.list` and `draft.get`.** Names have two segments, so the plan's `config.draft.*` became `draft.*`. A system with `config` has them; they refuse with a validation error when the server has no config remote, since local development edits the working tree.
- **A draft is a branch, `draft/<id>`, made from production's head, and a row in the new `drafts` table** (title, branch, base commit, the files it changes, status, the published and synced commits, who made it). Statuses are `draft`, `valid`, `invalid`, `awaiting_approval` (P2.09), `published` and `abandoned`.
- **Each save is one commit on the branch,** authored by the actor, with `Draft-Id` and `Actor-Id` trailers. Then the draft's whole set of files is validated against the running code, and the draft becomes `valid` or `invalid`. Paths must be `config/<type>/<key>.yaml`; `content: null` deletes the file.
- **Publishing is one squashed commit on production, made by the service,** not a merge of the branch. The draft's files are laid onto production's current head and validated together first. If production changed one of the draft's files since the draft began, publish is a conflict and nothing is written; files the draft didn't touch may have moved. The draft branch is deleted once published.
- **The bot copies the same files to `main`** as a second commit with a `Production-Commit` trailer, if each file on `main` is still what production had before the publish. If `main` changed one, the copy is skipped and the publish stands; `drafts.synced_sha` stays null to show it. Phase 3 moves this to wherever releases run.
- **The config service is `createGitConfigService` in `@workspace/config`:** a bare clone of the remote as a cache, and plumbing (`read-tree`, `update-index`, `commit-tree`, `push`) so it never needs a working tree. A push that isn't a fast-forward is retried from a fresh fetch. Its operations run one at a time, and it runs git with no global or system git config.
- **Actions reach it as `ctx.git`,** a `GitService` in `@workspace/actions` that `createServer` passes to the pipeline when it has a `configRemote`. Actions write draft rows through `ctx.drafts`, and read them through the DAL.
- **The loader takes a source.** With a remote, it reads production's head commit, checked out to a folder of its own, and the sha is that commit's. It reloads after each publish and, if `pollMs` is set, on a timer. Without one it reads the working tree as before (decision 0038).
- **Actions get `ctx.dryRun`.** A dry run is rolled back at the end, but a push isn't, so draft actions refuse dry runs. Other actions with effects outside the database (P2.15, P2.16) check it too.

## Consequences

- The git commands run inside the action's transaction, so a push can succeed and the transaction still fail. The draft row then says less than git does: a published draft can look `valid`. Publishing again then reports a conflict. Phase 3 can reconcile drafts with the remote if this happens in practice.
- A draft is checked against the code running now, and again against production when it publishes. A draft that was valid can be refused at publish because production moved.
- Drafts stay in the remote as branches until published. Abandoning a draft, and removing its branch, needs an action later.
- Approval rules (P2.09) hook into `draft.submit` and `draft.publish` through the `awaiting_approval` status.
