# AGENTS.md

Instructions for coding agents (Claude Code, Cursor and others) working in this repo. Humans should read them too.

## Read first

1. [docs/SYSTEM_DESIGN.md](docs/SYSTEM_DESIGN.md): how the system works. Its glossary (section 10) defines every term used here.
2. [docs/decisions/](docs/decisions/): why things are the way they are. Do not reverse a decision in code; propose a new decision record instead.

## Current state

Phase 0. Most packages are placeholders with a README describing their job. `apps/web` and `packages/ui` come from the shadcn TanStack Start template.

**Work from the plans.** Before starting, open [docs/plans/](docs/plans/README.md), find the current phase, read its **Resume here** section and pick the next unticked task whose dependencies are done. Tick it off, log it and update **Resume here** in the same PR as the work.

## Commands

```bash
pnpm install
pnpm dev
pnpm typecheck
pnpm lint
pnpm format
pnpm test
```

Once `fx` exists, use it for all change management (start, ship, switch) and never run raw git branch commands or Drizzle commands yourself.

## Architecture rules

These are enforced by review and, as the core grows, by CI. Breaking one is a bug.

1. **Every change to data is an action.** Write `defineAction`; never write to the database from routes, web code, workflows or scripts.
2. **Every read goes through the data access layer.** No raw SQL outside `packages/db`.
3. **Every table comes from `defineObject`.** No hand-written tables for client data.
4. **Config is data, not code.** Files under `config/` are YAML validated by Zod schemas. Never put logic, expressions or secrets in them.
5. **No database triggers** for business logic or history. Field history (`audit_log`) is written by the repository inside the action pipeline.
6. **The web surface is just another client.** `apps/web` calls the HTTP API. Do not use TanStack Start server functions or loaders to reach the database.
7. **Services come through the context.** Actions get the repository, config, clock and git service from `ctx`; never import them directly.
8. **Return typed errors.** Actions return typed error results (validation, permission, approval required, conflict, not found) instead of throwing for expected failures.
9. **Dependencies point one way:** `server`, `apps/web` → `workflows`, `config` → `actions` → `objects` → `db`. Modules depend on packages, never the reverse.
10. **Migrations expand, then contract.** Every migration must work with the code already running. No destructive change except as the marked contract step.
11. **Every side effect is an action.** Sending email, calling a URL or charging a card is an action (`comms.send`, `http.send`, `payments.refund`), so it is permission-checked and logged. Workflow steps only run actions or control flow; there is no `defineStep`.
12. **Workflows are the only listeners.** Nothing else subscribes to events. Work that must happen atomically with a change goes in the action; work that follows it goes in a workflow.
13. **Workflows act as themselves.** Their permissions are derived from the actions they run, and the publisher must hold all of them. Record `actor_id` and `origin_user_id` on every action; never add an `acting_for` or `triggered_by` field.
14. **`http.send` destinations are fixed.** URLs and hosts come from the workflow file, never from record data or event payloads.

## Naming

Use the glossary terms exactly: object, record, action, query, actor, user, permission, scope, draft, change, `event_log`, `audit_log`, `action_log`, `main`, `production`. Packages are `@workspace/<name>`.

## Stack

TypeScript (strict), Node 24, Hono, DBOS, Drizzle, Postgres, Zod 4, Better Auth, the official MCP SDK, TanStack, shadcn, Vitest. Do not introduce Effect or other frameworks that replace these; see decision 0008. Prefer adding nothing: ask before adding a dependency.

## Every change

- Small and focused: one ticket, one change, merged within hours or days.
- Comes with tests for what it adds.
- Passes typecheck, lint and tests locally before the PR.
- Updates docs or a decision record when it changes how something works.
- Commit messages use conventional commits (`feat:`, `fix:`, `docs:`, `chore:`).
