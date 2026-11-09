# AGENTS.md

Instructions for coding agents (Claude Code, Cursor and others) working in this repo. Humans should read them too.

## Read first

1. [docs/SYSTEM_DESIGN.md](docs/SYSTEM_DESIGN.md): how the system works. Its glossary (section 10) defines every term used here.
2. [docs/decisions/](docs/decisions/): why things are the way they are. Do not reverse a decision in code; propose a new decision record instead.

## Current state

Phases 0, 1 and 1b are done. `defineObject` gives an object its table, generated actions and queries, history and logs; the action pipeline runs every change; the HTTP API, MCP server and generated web screens all come from the same registry; `defineSystem` and `createServer` run a system. `examples/crm` is the working example: `pnpm fx dev` runs it, and `pnpm fx describe` shows what it has. The web app reaches all of it by section (Data, Activity, Access, Settings), and under `pnpm dev` a dev bar adds session switching, API and inspection tools (SYSTEM_DESIGN §4.9). Phase 2 is in progress: config is YAML under `config/`, validated and loaded live, and staff change it in drafts that publish to a git remote; approval rules make actions and drafts wait for sign-off; choice fields and the CRM's deals are built. On 9 Nov 2026 the model changed (decisions 0045 to 0047): the only endpoints become object endpoints and published workflows, actions become internal or external code that workflow steps run, runs replace `action_log`, and roles gain rules on endpoints, fields and rows. The code is moving to it task by task from P2.12, so `/actions`, `/queries` and dotted names still exist until P2.26; follow the model for new work. `packages/events`, `workflows` and `sdk` are still placeholders with a README describing their job.

**Work from the plans.** Before starting, open [docs/plans/](docs/plans/README.md), find the current phase, read its **Resume here** section and pick the next unticked task whose dependencies are done. Tick it off, log it and update **Resume here** in the same PR as the work. A change that isn't a plan task leaves the plan alone.

## Commands

```bash
pnpm install
pnpm dev
pnpm typecheck
pnpm lint
pnpm format
pnpm test
pnpm config:validate   # check config/ files against the running code
pnpm fx describe   # what the system has: objects, actions, queries, events and schemas
```

## Making a change

Use `fx` for all change management, and never run raw git branch commands or Drizzle commands yourself. Run it as `pnpm fx` from any checkout; there is no global `fx`. Every command takes `--json`. [tools/fx/README.md](tools/fx/README.md) has the details.

1. `pnpm fx start "<name>"` makes the branch `change/<slug>`, a worktree at `../factory.worktrees/<slug>`, and the change's own database and `.env`. Work in that worktree. For a plan task, put its ID in the name: `pnpm fx start "P1.01 define object"`. A dirty checkout is refused, and the error names the files. Stash them on that checkout and pop the stash there after `fx start`. The worktree is created from the commit, so the stash is not in it.
2. Edit and commit in the worktree. Later `fx` commands run in the worktree path from `fx start`. `pnpm fx dev` runs the dev servers on the change's database and pushes schema edits to it on save. You need it only to try the change by hand. An agent runs `pnpm fx dev --json` in the background, waits for the `schema_pushed` line, and stops it with SIGTERM.
3. `pnpm fx ship`, with everything committed, rebases on `origin/main` and writes the change's one migration. Then it runs every check CI runs, pushes, and opens or refreshes the PR. The first commit's subject is the squash subject on main, so it has to describe the whole change. Later commits are written into the PR body on the next ship. A green ship is the local run. It then waits for GitHub's `check` and prints the failing log. `fx status` shows that check too. Merge only after it is green.
4. Once the PR is merged, run `pnpm fx done <name>` from the main checkout. It removes the worktree, the branches and the database, fast-forwards a clean main checkout to `origin/main`, and runs `pnpm install` when `pnpm-lock.yaml` changed. A dirty main checkout is left as it is, with the files named.

Tests run on databases built from the migrations, not from the schema. After a schema edit, tests that use it fail until there is a migration. `fx ship` writes the migration before it runs the checks, so use it to check a schema change. It pushes nothing if a check fails.

`main` takes only squash-merged PRs with a green `check`; see [docs/branch-protection.md](docs/branch-protection.md).

## Architecture rules

These are enforced by review and, as the core grows, by CI. Breaking one is a bug.

1. **Every change to data runs in an action, reached through an endpoint.** The only endpoints are object endpoints (from `defineObject`) and published workflows; actions are internal code that workflow steps run, never on a surface. Never write to the database from routes, web code or scripts (decision 0045).
2. **Every read goes through the data access layer.** No raw SQL outside `packages/db`.
3. **Every table comes from `defineObject`.** No hand-written tables for client data.
4. **Config is data, not code.** Files under `config/` are YAML validated by Zod schemas. Never put logic, expressions or secrets in them.
5. **No database triggers** for business logic or history. Field history (`audit_log`) is written by the repository inside the segment's transaction.
6. **The web surface is just another client.** `apps/web` calls the HTTP API. Do not use TanStack Start server functions or loaders to reach the database.
7. **Services come through the context.** Actions get the repository, config, clock and git service from `ctx`; never import them directly.
8. **Return typed errors.** Actions and steps return typed error results (validation, permission, conflict, not found, or a declared code) instead of throwing for expected failures.
9. **Dependencies point one way:** `server`, `apps/web` → `workflows`, `config` → `actions` → `objects` → `db`. Modules depend on packages, never the reverse.
10. **Migrations expand, then contract.** Every migration must work with the code already running. No destructive change except as the marked contract step.
11. **Every side effect is an external action.** Sending email, calling a URL or charging a card is an external action (`comms_send`, `http_send`, `payment_refund`) run by a workflow step, outside the transaction with a retry key, and traced. Workflow steps only run actions or built-in control flow; there is no `defineStep`. Actions never write logs; the engine writes the run and its steps.
12. **Workflows are the only listeners.** Nothing else subscribes to events. Work that must happen atomically with a change goes in the same segment (steps between pauses commit together); work that follows it goes in a workflow its event starts.
13. **Workflows run under the service key.** The caller's role is checked once, at the endpoint; the workflow's actions then run with full internal access, and the publish gate (validation, example cases, two people) is the control. Record the workflow as `actor_id` and the caller as `origin_user_id` on every run; never add an `acting_for` or `triggered_by` field.
14. **`http_send` destinations are fixed.** URLs and hosts come from the workflow file, never from record data or event payloads.

## Naming

Use the glossary terms exactly: object, record, endpoint, action (internal or external), workflow, step, run, run step, segment, trace, retry key, service key, actor, user, role, scope, draft, change, `event_log`, `audit_log`, `main`, `production`. "Query" is retired. Names of objects, fields, actions, workflows, events, roles and config keys are snake_case and the same on every surface (`deal_move_stage` is the file, the URL and the MCP tool; decision 0047); code still has dotted names until the tasks that rename them. Packages are `@workspace/<name>`.

## Stack

TypeScript (strict), Node 26, Hono, DBOS, Drizzle, Postgres, Zod 4, Better Auth, the official MCP SDK, TanStack, shadcn, Vitest, and Ultracite (Oxlint + Oxfmt) for linting and formatting; see decision 0012. Do not introduce Effect or other frameworks that replace these; see decision 0008. Prefer adding nothing: ask before adding a dependency.

## Every change

- Small and focused: one ticket, one change, merged within hours or days.
- Comes with tests for what it adds.
- Passes typecheck, lint and tests locally before the PR. `fx ship` runs them all and stops before pushing if one fails. That green run is local. GitHub's `check` is the one that has to be green before merging, and `fx ship` waits for it.
- Updates docs or a decision record when it changes how something works.
- Commit messages use conventional commits (`feat:`, `fix:`, `docs:`, `chore:`).
