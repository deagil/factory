# Factory

> Working name. The CLI name `fx` is a placeholder too.

A personal software factory: a core I own that lets me, working mostly through AI agents, stand up a back-office system for a client quickly, then run it for them or hand it over.

Each client gets their own system: a thin repo that pins a version of the core packages, adds the client's own objects and logic, and keeps all of its configuration as files. It deploys as one API service, one static web front end and one Postgres database.

**Status: phase 2 in progress.** The walking skeleton works: objects defined once get generated actions, history and logs, an HTTP API with OpenAPI, MCP tools and generated web screens. `examples/crm` runs it end to end. All of it is usable from the web app, by section. Config is YAML validated against the code and loaded live, with choice fields and drafts that publish over git; approvals and workflows follow, and `events`, `workflows` and `sdk` are still placeholders. Start with [docs/SYSTEM_DESIGN.md](docs/SYSTEM_DESIGN.md).

## What it is, and what it isn't

- **It is** a core for mid and back-end systems used by a client's staff: CRMs, case and approval systems, bookings and scheduling, and the integrations around them.
- **It is not** an end-user product, a low-code platform for the public, or a website builder. Public websites and customer apps are separate front ends that call a system's API from their own servers.
- **The users of the core** are me and my agents. **The users of each system** are the client's staff, plus any external systems the client connects.

## Key ideas

1. **One action registry, many surfaces.** Every capability is a typed action or query, defined once. The HTTP API, MCP server, CLI, web surface and in-app agent are all built from those definitions, and nothing writes data any other way.
2. **Agent parity.** The in-app agent has no powers that Claude Code connected over MCP lacks. Permissions, not separate channels, decide who can do what.
3. **Objects are code.** Every record type is one `defineObject` in TypeScript. The table, validation, actions, screens and agent tools all derive from it.
4. **Config is files in git.** Workflows, custom fields, choice lists, roles, approval rules, templates and pages are files in the client repo. Developers and agents edit the files; staff edit them through the web surface, which commits the same files. The running system loads config from git without a deploy.
5. **Config changes behaviour; data is what the business does.** Pipeline stages are config. Deals, prices and bookings are data, in Postgres.
6. **Work happens in changes.** One change is one ticket, branch, worktree, local database, preview and PR, managed by `fx`.
7. **Trunk-based, with a `production` branch.** Changes merge into `main`. Releases promote `main` to `production`. Staff edit `production`, and their edits are copied back to `main` by the sync bot.
8. **Verification is the product.** Agents can be trusted as far as the checks reach: types, schemas, config validation, migration linting, contract tests and previews.

## Repo layout

```
factory/
  apps/
    web/           the staff web surface (TanStack Start in SPA mode, shadcn)
  packages/
    ui/            shared shadcn components
    db/            Drizzle setup, core tables, migration runner, schema check
    objects/       defineObject, field types, data access layer, field history
    actions/       defineAction, defineQuery, the action pipeline, permissions, logs
    config/        config schemas, git config service, config loader, drafts
    workflows/     workflow schema, dispatcher, DBOS interpreter, run log
    events/        event types, event_log, inbound webhook routes
    auth/          Better Auth, users, actors, API keys
    server/        Hono + DBOS service: HTTP API and MCP server, generated from the registry
    sdk/           generated typed client for external systems
    testing/       seed fixtures, test database helpers, generated contract tests
  modules/
    comms/         email templates, sending, delivery log
    documents/     files, attachments, generated documents
    payments/      Stripe payments and invoices
    reports/       saved queries, charts, exports
  tools/
    fx/            the factory CLI and its MCP server
  templates/
    client/        starting point for a new client repo
  examples/
    crm/           example system: organisations, contacts, deals, activities
    bookings/      example system (phase 4)
    cases/         example system (phase 4)
  docs/
    SYSTEM_DESIGN.md
    decisions/     one record per settled decision
```

## Getting started

You need Node 26 (CI uses the version in `.nvmrc`), Docker, and pnpm 12.

```bash
npm install -g pnpm@12    # pnpm 12 then runs the version in package.json
pnpm install
[ -f .env ] || cp .env.example .env   # local defaults work as they are
pnpm db:up                # Postgres 18 in Docker; waits until it is healthy
pnpm dev                  # migrates the database in .env, then runs the CRM server, the web app and Drizzle Studio
```

In the main checkout, `pnpm dev` runs the example CRM on the main `factory` database, so you can look around without starting a change: sign in at <http://localhost:3000> as `admin@example.com` with the code printed in the console, and see the data in Drizzle Studio at <https://local.drizzle.studio>. Each process gets its own tab in Turbo's terminal UI. In a change's worktree, use `pnpm fx dev` instead, which runs on the change's own database.

Checks, which CI also runs:

```bash
pnpm typecheck
pnpm lint                 # Ultracite: Oxlint and Oxfmt, per package
pnpm test                 # Vitest, per package
pnpm format               # fix lint and formatting across the repo
```

`pnpm db:down` stops Postgres and keeps its data. To start again from an empty database, run `docker compose down -v`. If port 5432 is taken, set `POSTGRES_PORT` and change the port in `.env` to match.

To add a shadcn component to the shared UI package, run this from the repo root:

```bash
pnpm dlx shadcn@latest add button -c apps/web
```

Components land in `packages/ui/src/components` and are imported as `@workspace/ui/components/button`.

## Working on the factory

Every change goes through `fx`, run as `pnpm fx`. [tools/fx/README.md](tools/fx/README.md) has the details.

```bash
pnpm fx start "deal pipeline"   # new change: branch, worktree and its own database
pnpm fx dev                     # in the worktree: dev servers on the change's database
pnpm fx ship                    # rebase, write the migration, run every check, refresh the PR, wait for GitHub's check
pnpm fx done                    # after the merge: remove the change, then fast-forward a clean main
pnpm fx switch refunds          # where another open change's worktree is
pnpm fx status                  # the current change, its last local checks, and GitHub's check
pnpm db:studio                  # Drizzle Studio on its own, when the dev servers aren't running
```

`main` takes only squash-merged PRs with green CI; see [docs/branch-protection.md](docs/branch-protection.md). Phase 3 adds `fx release`, which promotes a client repo's `main` to `production` on approval.

Agents follow [AGENTS.md](AGENTS.md).

## Stack

TypeScript throughout: Hono and DBOS on the server, Drizzle on Postgres, Zod 4, Better Auth, the official MCP SDK, TanStack and shadcn on the web, Vitest, Ultracite (Oxlint + Oxfmt), pnpm and Turborepo. One instance per client on a simple PaaS. Effect was assessed and deferred; see [decision 0008](docs/decisions/0008-plain-typescript-effect-deferred.md).

## Build plan

Task lists for each phase, with progress, are in [docs/plans/](docs/plans/README.md).

| Phase | Goal |
| --- | --- |
| 0. Foundations | The factory can build itself: workspace, `fx start/dev/ship`, local databases, CI |
| 1. Walking skeleton | One object on every surface: pipeline, history, generated screens and MCP tools |
| 1b. Web surface | Everything phase 1 built, usable and testable from the web app |
| 2. Config over git | Staff change behaviour: choice fields, drafts, workflows, comms |
| 3. CRM, hosted | A system I could hand to a client, with releases and the `production` branch |
| 4. Breadth | Bookings, cases, reports, page builder, in-app agent |
