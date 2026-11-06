# 0003. Config is files in git

- **Status:** Accepted
- **Date:** 2026-11-06

## Context

Staff need to change behaviour (fields, choice lists, roles, approval limits, workflows, templates, pages) without a developer. Config stored in the database, as in previous systems, drifts from the repo, is invisible to coding agents, hard to test in CI and needs its own history and promotion tooling.

## Decision

All config lives as YAML files under `config/` in the client repo. Developers and agents edit the files; staff and the in-app agent edit them through the web surface or MCP, which commit the same files. Staff drafts are short-lived branches from `production`, validated against the running code, approved where policy says, and merged. The running system loads config from git (webhook or poll) and swaps it in without a deploy. Any git remote works. Data (records, prices, sessions, capacity) stays in Postgres.

## Consequences

- One source of truth; history, diffs, rollback and promotion come from git.
- Instances only load config that validates against the code they run.
- Staff changes take seconds, not instant; changes needed several times a day are data, not config.
- Each instance needs credentials for its git remote.
