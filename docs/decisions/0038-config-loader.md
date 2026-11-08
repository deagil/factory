# 0038. The config loader

- **Status:** Accepted
- **Date:** 2026-11-08
- **Amends:** [0031](0031-define-system-and-create-server.md), whose `defineSystem` took roles.

## Context

Config is YAML files checked by `validateConfig` (decisions 0037, P2.04). A running system has to read them, change behaviour when they change without a restart or deploy, and never run on config that failed validation. Phase 2 reads `config/` from the working tree locally; drafts publish to a git remote from P2.08.

## Decision

- **`createConfigLoader` in `@workspace/config`** reads `config/`, validates it against the running code, and swaps an in-memory index in one go. A version with problems is refused: the last good one stays live and the problems are logged with file and line. At start-up there is no last good version, so `createServer` refuses to start on invalid config.
- **Every version tried is recorded** in a new core table, `config_versions` (`sha`, `status` `loaded` or `refused`, `errors`, `loaded_at`). Only the loader writes it. A version that is already live isn't recorded again.
- **A working tree's sha is a hash of its files:** sha1 over each file's path and contents, so the same files always give the same sha. It looks like a commit sha but isn't one. Reading a commit from a git remote, and recording the commit's sha, comes with the config service in P2.08.
- **`ConfigService` is backed by the loader.** Its `sha` and `roles` are the live version's. The pipeline pins a snapshot when a run starts, so a run reads one version throughout and `action_log.config_sha` is the version it ran under. `ConfigService.validate()` checks `config/` on disk, which is how `config.validate` reaches it (AGENTS.md rule 7).
- **`defineSystem` takes `config` (the folder) instead of `roles`.** The system's roles are its `config/roles/*.yaml`. With no config folder a system has no roles.
- **Locally the server watches `config/`** (`createServer({ watchConfig: true })`, set under `pnpm dev`) and reloads on save, debounced by 100 ms. Loads run one at a time, so the last save wins.

## Consequences

- Editing a role file under `pnpm dev` changes what people can do on the next request.
- A system's config and its code must agree before it starts: a role naming an action that was removed stops the server with the file and line.
- `config_versions` grows with every save in development; that's fine for a disposable change database.
