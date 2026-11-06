# 0004. Trunk-based development with a production branch

- **Status:** Accepted
- **Date:** 2026-11-06

## Context

Developers and agents need fast integration; staff need to edit what production actually runs without being blocked by unreleased work.

## Decision

Changes are short-lived branches merged into `main` (trunk) through PRs with green checks; unfinished work hides behind feature flags. Staging runs `main`. Releases promote `main` to `production` on my approval; production runs `production`. Staff drafts merge into `production`, and the sync bot copies each one back to `main`. Migrations are generated once per change, applied to staging on merge and to production on release, and must expand before they contract.

## Consequences

- `production` is always exactly what production runs.
- Copying back departs from strict trunk-based guidance, which is acceptable because the bot does it automatically and only for config.
- `fx` and CI handle branches, worktrees, databases and migrations so nobody has to remember the process.
