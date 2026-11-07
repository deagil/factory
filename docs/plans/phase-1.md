# Phase 1: Walking skeleton

**Goal:** one path through every layer. Two objects (organisation and contact) are defined once with `defineObject`. They get generated actions, history and logs, and appear on every surface: the HTTP API with OpenAPI, MCP, and generated list and record screens in the web app. A record created from the web, from Claude Code over MCP or with `curl` produces the same `action_log`, `audit_log` and `event_log` rows.

**Out of scope:**

- Choice fields, custom fields edited by staff, config over git, drafts and approval rules (phase 2).
- Workflows and the event dispatcher (phase 2). Events are written to `event_log` but nothing reacts to them yet.
- Client SSO and hosting (phase 3).
- Scoped permissions beyond `all`, the page builder and the in-app agent (later).

## Resume here

- **Status:** in progress. P1.01 to P1.12 are done.
- **Next task:** P1.15, the MCP server: `packages/server/src/mcp.ts` already registers a tool per definition and serves them statelessly at `/mcp` behind the API's caller check (decision 0026). Finish it: tool annotations (read-only for queries), typed errors as tool errors, and connect Claude Code with an agent key to list tools and create a record (agent as actor, user as origin).
- **Handover:** [phase-1-handover.md](phase-1-handover.md) has the state of the code, the conventions and the traps found so far. Read it before P1.07.
- **Known issues:**
  - drizzle-kit can't tell a rename from a drop and an add without asking, and it can't ask without a terminal. `fx dev` points to `fx dev --reset`. `fx ship` stops with the expand/contract way: add the new column, copy the data, and drop the old one in a later contract step.
  - drizzle-kit 0.31 drops and re-adds `actor_roles`' composite primary key on every push. It's harmless on a change database, but it means a push is never "no changes".
- **How to start:** see [docs/plans/README.md](README.md). Every change goes through `pnpm fx start` → `pnpm fx ship` → `pnpm fx done`; AGENTS.md says how.

## Decisions for this phase

These fill gaps until later phases replace them. Don't build further than this.

- **Roles come from a `ConfigService` interface.** In phase 1 it's backed by a static object passed to `defineSystem`. Phase 2 replaces it with the git config loader, so the YAML-or-JSON question can wait.
- **Approvals:** the approve stage exists in the pipeline but finds no rules, so it always passes. It has a test seam so phase 2 can plug rules in.
- **Sign-in:** Better Auth with an email code or magic link, printed to the server console locally. SSO comes in phase 3.
- **Agents and integrations** authenticate with API keys. An agent key belongs to an agent actor linked to a user. Its actions record the agent as `actor_id` and that user as `origin_user_id`, and it can never do more than the user.
- **The first runnable system is `examples/crm`.** Core packages never import from `examples/`; their tests define small objects inline.
- **`config_sha`** is `null` on every `action_log` row until phase 2.

## Tasks

### Objects (`@workspace/objects`; SYSTEM_DESIGN §4.1)

- [x] **P1.01 Field types**
  - A field type library with `text`, `number`, `money`, `date`, `boolean` and `ref`.
  - Each type gives its Drizzle column, a Zod rule for input, a Zod rule for output, a plain display value, and the filter operators it supports.
  - **Done when:** every type has tests for column shape, valid and invalid input, and its filters.

- [x] **P1.02 `defineObject`**
  - Returns a real Drizzle table with housekeeping columns (`id`, `created_at`, `updated_at`, `archived_at`, `custom_fields`). It also returns derived create, update and record schemas, and registers the object by name.
  - Supports `list`, `label`, the `actions` options (`readOnly`, off) and a `drizzle` escape hatch for indexes.
  - Refs point at other objects or at `actor`.
  - **Needs:** P1.01.
  - **Done when:** a test object generates a migration through drizzle-kit, and its derived schemas accept and reject the right input.

- [x] **P1.03 Schema check**
  - Compares the database with the object definitions and core tables. It runs at start-up, failing with a clear message, and in CI. It also fails if a table isn't from `defineObject` or the core.
  - **Needs:** P1.02.
  - **Done when:** a missing column or a stray table fails the check with a message saying what to do.

- [x] **P1.04 Data access layer**
  - The only read path: `get`, `list` with filter, sort and cursor pagination, plus following refs one level deep.
  - Hides archived records unless asked, and applies a permission filter hook (`all` scope only for now).
  - No raw SQL outside `packages/db`.
  - **Needs:** P1.02, P0.06.
  - **Done when:** tests cover every filter operator, sorting, paging, archived records and the permission hook.

- [x] **P1.05 Repositories and `audit_log`**
  - The only write path: `create`, `update` (with an optional row lock) and `archive`.
  - Each create and update reads the current row, works out which fields changed, and writes one `audit_log` row in the same transaction, with the changed fields in `before` and `after` (decision 0018). Housekeeping columns are skipped, and custom fields are diffed per key.
  - Repositories refuse to run outside an action's transaction.
  - **Needs:** P1.04.
  - **Done when:** an update changing two fields writes exactly one `audit_log` row holding both; a no-op update writes none; a call outside a transaction throws.

- [x] **P1.05a Drop `audit_log`'s old columns (contract step)**
  - Drop `field`, `old_value` and `new_value`, which nothing has written since P1.05. Ship with `pnpm fx ship --contract-step "audit_log is one row per change (decision 0018)"`.
  - Remove them from `core.ts` and the db README.
  - **Needs:** P1.05 merged.
  - **Done when:** the migration drops the three columns and the schema check passes.

### Actions (`@workspace/actions`; SYSTEM_DESIGN §4.2)

- [x] **P1.06 `defineAction`, `defineQuery` and the registry**
  - Name, description, input and output schemas, `emits` with a schema per event, and the handler.
  - The context `ctx` carries `repo`, `dal`, `config`, `clock`, `actor`, `emit` and the error helpers.
  - Typed error results: validation, permission, approval required, conflict, not found.
  - The registry lists every action and query with its schemas.
  - **Needs:** P1.05.
  - **Done when:** registering two actions with the same name fails, unknown events passed to `emit` fail type-checking, and handlers can't reach services except through `ctx`.

- [x] **P1.07 The action pipeline**
  - Runs identify, validate, authorise, approve (no rules yet), run, record and commit, all in one transaction.
  - Record writes the `action_log` row (`actor_id`, `origin_user_id`, input, result or error, status) and the `event_log` rows with `origin_user_id` and depth 0.
  - Failures roll everything back but still leave a failed `action_log` row, written in its own transaction.
  - `audit_log.action_id` references `action_log`, so the `action_log` row is inserted at the start of the transaction, before the handler runs, and filled in at record. `actionStatuses` has no in-flight value (`pending_approval`, `succeeded`, `failed`, `rejected`); decide whether to add one or insert with the final status, and say which in a decision record.
  - **Needs:** P1.06.
  - **Done when:**
    - Each stage has a test.
    - A handler error leaves no data change and one failed `action_log` row.
    - A success leaves the data change, the `audit_log`, `action_log` and `event_log` rows, or none of them.

- [x] **P1.08 Retry keys and dry run**
  - **Retry keys:** an action sent again with the same key returns the earlier result without running again.
  - **Dry run:** the action runs through every stage, then rolls back, and returns what would have happened.
  - **Needs:** P1.07.
  - **Done when:** two concurrent calls with the same key run the handler once, and a dry run changes nothing except one `action_log` row marked `dry_run`.

- [x] **P1.09 Generated actions and queries**
  - Each object gets `<object>.create`, `.update` and `.archive` actions and `<object>.get` and `.list` queries, built from its definition.
  - They emit `<object>.created`, `.updated` and `.archived`.
  - `readOnly` fields are removed from the update input. A hand-written action that owns a job (`actions: { create: 'booking.place' }`) switches the generated one off.
  - **Needs:** P1.08.
  - **Done when:** tests cover each generated action and query, `readOnly`, switching off, and the events.

### Identity and permissions (`@workspace/auth`; SYSTEM_DESIGN §4.3)

- [x] **P1.10 Users, actors and sign-in**
  - Better Auth with an email code or magic link (console delivery locally), sessions, and its tables in a migration.
  - Signing in finds or creates the user's staff actor.
  - The pipeline's identify stage resolves a session to an actor.
  - **Needs:** P1.07.
  - **Done when:** a test signs in with a code, gets a session, and an action run with that session records the right `actor_id` and `origin_user_id`.

- [x] **P1.11 Roles, permissions and authorise**
  - Roles come through `ConfigService` (see "Decisions for this phase"). Each permission has an object or action, a verb and a scope (`all` only); `actor_roles` link actors to roles.
  - The authorise stage and the data access layer filter both use them, and permission errors say which permission was missing.
  - **Needs:** P1.10.
  - **Done when:** an actor without the permission gets a permission error and no data change, and `list` returns nothing for an object the actor can't read.

- [x] **P1.12 API keys, integration actors and agent actors**
  - Create, revoke and use API keys. Keys are stored hashed and `last_used_at` is recorded.
  - Integration actors are scoped to the actions they're allowed.
  - Agent actors are linked to a user and are never wider than that user.
  - Creating and revoking keys are themselves actions.
  - **Needs:** P1.11.
  - **Done when:** a revoked key is refused, an agent key can't do what its user can't, and an agent's actions record the agent as actor and the user as origin.

### Surfaces (`@workspace/server`; SYSTEM_DESIGN §4.9 and §7)

- [x] **P1.13 Transport prototype and decision**
  - Expose one action over HTTP with OpenAPI, and as an MCP tool, twice: once with our own generator on Hono and once with oRPC.
  - Keep whichever needs less code and fewer special cases, delete the other, and record the choice as the next decision record (0026 at the time of writing; 0012 is taken).
  - **Needs:** P1.09.
  - **Done when:** the decision record is merged and only one approach is left in the code.

- [x] **P1.14 HTTP API**
  - Hono routes generated from the registry (`POST /actions/<name>`, `GET`/`POST /queries/<name>`), with an OpenAPI document at `/openapi.json`.
  - Takes a session or an API key, and a retry key from the `Idempotency-Key` header.
  - Typed errors map to status codes with a stable JSON error shape, and every request gets a request ID.
  - **Needs:** P1.12, P1.13.
  - **Done when:** every registered action and query is reachable, the OpenAPI document validates, and errors use the documented shape.

- [ ] **P1.15 MCP server**
  - One MCP tool per action and query, generated from the registry with the action descriptions and schemas. It runs over streamable HTTP with an API key as the bearer token.
  - **Needs:** P1.14.
  - **Done when:** Claude Code connects with an agent key, lists the tools, and creates a record, with the agent as actor and its user as origin.

- [ ] **P1.16 Introspection**
  - A `system.describe` query returns the objects, fields, field types, actions, queries, events and their schemas, filtered by what the caller may use.
  - The web app and agents use it to build screens and understand the system.
  - **Needs:** P1.14.
  - **Done when:** the result for a restricted actor leaves out what it can't use, and a snapshot test catches unintended changes.

- [ ] **P1.17 Contract tests across surfaces**
  - Generated tests run every action through the HTTP API and through MCP with the same input, and check that both give the same result and the same log rows.
  - **Needs:** P1.15, P1.16.
  - **Done when:** the tests run in CI for every registered action, and a deliberate difference between surfaces fails them.

### The first system (`examples/crm`; SYSTEM_DESIGN §2)

- [ ] **P1.18 `defineSystem`, `createServer` and the CRM example**
  - `defineSystem` collects objects, actions and roles; `createServer` runs it.
  - `createServer` runs `assertSchema(db, [...coreTables, ...objectTables])` before it serves, and the CRM's CI runs `checkSchema` on its migrated database (decision 0016).
  - `examples/crm` defines `organisation` and `contact`. It adds one hand-written action, `contact.moveToOrganisation`, which owns the contact's `organisation` field (so the generated update marks that field read-only) and emits `contact.moved`.
  - It also has roles for admin and sales, seed data, and `pnpm dev` wired through `fx dev`.
  - **Needs:** P1.17.
  - **Done when:** `fx dev` in `examples/crm` serves the API and MCP against seeded data, and its tests pass in CI.

### Web surface (`apps/web`; SYSTEM_DESIGN §4.9)

- [ ] **P1.19 Sign-in, app shell and API client**
  - A sign-in screen, an app shell with navigation built from `system.describe`, and a typed API client over the HTTP API.
  - TanStack Query for data; no server functions or loaders that reach the database.
  - **Needs:** P1.18.
  - **Done when:** a seeded user signs in with a code and sees navigation for exactly the objects they can read.

- [ ] **P1.20 Generated list screen**
  - One list screen per object, built from `system.describe`, using the object's `list` columns.
  - Filters, sorting and paging go through the `.list` query, and the URL keeps the filter state.
  - **Needs:** P1.19.
  - **Done when:** organisation and contact lists work with no screen code specific to either object.

- [ ] **P1.21 Generated record screen and history**
  - View, create, edit and archive records, with forms built from the action input schemas. Read-only fields aren't editable, and the hand-written action appears as a button.
  - A history tab shows the record's `audit_log` and `action_log` entries, through a `record.history` query. Each `audit_log` row is one change with its fields `before` and `after` (decision 0018), so one row is one timeline entry.
  - **Needs:** P1.20.
  - **Done when:** editing a contact shows the field changes in history with who made them, and moving it to another organisation is only possible through the button.

### Exit

- [ ] **P1.22 `fx describe`** _(stretch)_
  - `fx describe [object|action]` prints the registry for the current repo, as text or `--json`. It lets agents building a system see what exists without reading every file.
  - **Needs:** P1.16.
  - **Done when:** it lists the CRM's objects, actions, events and schemas.

- [ ] **P1.23 Phase exit demo**
  - In `examples/crm`, create an organisation three ways: from the web app, from Claude Code over MCP with an agent key, and with `curl` and an integration key.
  - Check that the `action_log` rows match in shape, that actors and origin users are right, that history shows every change, and that the events are in `event_log`.
  - Record any surprises in the log.
  - Then update `AGENTS.md` and the README status, set phase 1 to Done in `docs/plans/README.md`, and write `phase-2.md`. Plan the Effect trial from decision 0008 as part of that.
  - **Needs:** all of the above except P1.22.
  - **Done when:** the demo works end to end from a clean clone.

## Log

<!-- One line per finished task: YYYY-MM-DD · P1.xx · PR link · notes for the next person -->

- 2026-11-06 · plan written.
- 2026-11-06 · P1.01 · [#20](https://github.com/deagil/factory/pull/20) · `f.text`, `f.number`, `f.money`, `f.date`, `f.boolean` and `f.ref` in `packages/objects/src/fields`, with decision 0014 for what the design left open. Money is a `bigint` of minor units plus a `<field>_currency` column, and its value is `{ amount, currency }`. Dates are `YYYY-MM-DD` strings. Refs are `<field>_id` uuid columns. Input schemas hold the rules; output schemas only check the shape. Filters are objects of operators (`{ gte: 10, lt: 20 }`); `filterSchema(field)` validates one and `filterWhere(field, columns, filter)` builds its condition, for P1.04. Tests render the conditions with Drizzle's `PgDialect`; P1.04 runs them against Postgres. Ultracite turns `type X = { ... }` into an interface, and an interface doesn't fit `Record<string, …>`, so column maps are written as `MainColumn<…>` (a `Record`). Its Vitest rules want `toStrictEqual`, `toBeFalsy` and at most five `expect`s per test.
- 2026-11-06 · P1.02 · [#21](https://github.com/deagil/factory/pull/21) · `defineObject` in `packages/objects/src/define-object.ts`, with decision 0015. Besides the plan's housekeeping columns it adds `created_by`, `updated_by` and `version` from SYSTEM_DESIGN section 3, and `custom_fields` only with `customFields: true`. Records are JSON-safe, with ISO timestamps; `fromRow` and `toRow` map between records and rows, and `columnsOf(key)` gives a field's columns for P1.04's filters. The `update` schema already leaves out `readOnly` fields, so P1.09 can use it as it is. Refs get a foreign key and an index; refs to objects not yet defined resolve lazily. The Done-when test runs `drizzle-kit generate` on a fixture CRM against a copy of the core migrations, applies the result to a test database, and round-trips a record. Found on the way: drizzle-kit loads schema files as CommonJS, so `import.meta` fails there, hence the new `@workspace/db/schema` entry point; repeated `--schema` flags don't add up, so the test writes a temporary config; and `--out` must be a relative path. Field factories now return `NoInfer<…>` types, or `required: true` inside a `fields` literal widens to `boolean`.
- 2026-11-06 · P1.03 · [#22](https://github.com/deagil/factory/pull/22) · `checkSchema(db, tables)` and `assertSchema` in `packages/db/src/schema-check.ts`, with decision 0016. It compares `public` only. It fails on a missing table or column, a different type or nullability, and a table the code doesn't define. It allows, and lists, columns the code no longer uses, since a contract step drops them later. Types are compared as `format_type` prints them; `normaliseType` maps Drizzle's names. `db:check-migrations` now runs it on its freshly migrated database, so CI and `fx ship` both do. There was no server to run it at start-up yet, so P1.18 now says `createServer` calls `assertSchema`. The objects migration test runs it on the fixture CRM's tables, which covers every field type's column. Found on the way: a `.cursor/hooks/state/` folder from Cursor made the main checkout dirty, so `fx start` refused. I excluded it in `.git/info/exclude` on this machine; consider gitignoring it.
- 2026-11-06 · P1.04 · [#23](https://github.com/deagil/factory/pull/23) · `createDataAccess({ executor, canRead })` in `packages/objects/src/dal/`, with decision 0017. `list` takes `filter`, one `sort` (`-createdAt` by default, empty values last), a keyset `cursor`, `limit` (50, at most 200), `archived` and `expand`; `listInputSchema(object)` validates it, ready for P1.09's `.list`. Followed refs come back in `related[field][id]`, never inside records. `canRead` answers `"all"` or `"none"` per object. With `"none"` a list is empty and `get` is null, and related records are left out. `NULLS LAST` ordering comes from `@workspace/db` (`ascNullsLast`, `descNullsLast`), keeping raw SQL there. Tests run every filter operator of every type, sorting, paging through empty values and ties, archived modes, refs and the hook against Postgres. The fixture CRM's database setup moved to `src/test-fixtures/crm-database.ts`. `AnyObjectDefinition` is now a wide interface, like `AnyField`, because concrete tables didn't fit `ObjectDefinition<string, any, …>`.
- 2026-11-06 · P1.05 · [#24](https://github.com/deagil/factory/pull/24) · `createRepository({ executor, actionId, actorId, now })` in `packages/objects/src/repository.ts`, with decision 0018. `audit_log` is now one row per record change with `before` and `after` JSONB, holding only changed fields (custom fields as `customFields.<key>`), plus a GIN index on `after`; the plan had a row per field, changed at the user's request. The migration only expands: `field` becomes nullable and the old columns stay until P1.05a drops them. `update` returns `updated`, `unchanged`, `not_found`, `archived` or `conflict`; with `lock` it reads `FOR UPDATE`, and it always writes `WHERE version = …`, so an unlocked race gives `conflict` rather than a lost update. Archiving writes no `audit_log` row. Values are compared with `isDeepStrictEqual`, so money and dates compare by value. The repository checks values with each field's input schema; read-only fields are the generated update action's job (P1.09), not the repository's.
- 2026-11-06 · P1.05a · [#25](https://github.com/deagil/factory/pull/25) · Contract step for decision 0018: drops `audit_log`'s `field`, `old_value` and `new_value`, shipped with `fx ship --contract-step`. `audit_log` is now `id, object, record_id, before, after, action_id, actor_id, at`, as SYSTEM_DESIGN section 3 says.
- 2026-11-06 · handover · [phase-1-handover.md](phase-1-handover.md) written after P1.05a. P1.07 now notes the `action_log` ordering and status question; P1.13's decision number fixed (0012 was taken); P1.21 notes the one-row-per-change history.
- 2026-11-07 · P1.06 · [#27](https://github.com/deagil/factory/pull/27) · `defineAction`, `defineQuery`, `createRegistry`, `createActionContext`/`createQueryContext` and typed errors in `packages/actions/src`, with decision 0019. Handlers return typed errors (`return ctx.notFound(…)`) as branded `ActionFailure`s; `isActionFailure` finds them, and the pipeline should treat a thrown one the same. `ctx.emit` is typed from `emits`; `@ts-expect-error` tests under `pnpm typecheck` prove undeclared events and wrong payloads fail. Queries get no `repo` or `emit`. `ConfigService` lives in `actions` (config depends on actions) and holds only `sha` until P1.11. Actions and queries share one namespace in the registry. "Only through ctx" is enforced by `checkHandlerBoundary` (`@workspace/actions/boundary`): files that call `defineAction`/`defineQuery` may not import db, config, auth, server, drizzle-orm or pg, build repositories, or read the system clock; a test runs it over the repo. Handlers may return a value or a promise, which keeps Oxlint's `require-await` quiet for trivial ones. SYSTEM_DESIGN's `deal.moveStage` example now uses the real API. P1.13's decision record is now 0020.
- 2026-11-07 · P1.07 · [#28](https://github.com/deagil/factory/pull/28) · `createPipeline({ db, config, clock, permissions?, approvals? })` in `packages/actions/src/pipeline.ts`, with decision 0020. `run` and `query` return `{ ok, … }` and never throw for a failed action. No in-flight status: the `action_log` row goes in as `succeeded` inside the transaction and is only seen after commit; failures write a separate `failed` row after the rollback, and an approval match writes `pending_approval`. Unknown actors write nothing. Unexpected errors return `internal` with a generic message; the row has the real one. `permissions` and `approvals` are the seams for P1.11 and phase 2; they return a failure or rule key, or null (Oxlint's `no-useless-undefined` rewrites `() => undefined` into an empty function, which `no-empty-function` then refuses). The CRM fixture is now exported from `@workspace/objects/testing` for other packages' tests.
- 2026-11-07 · P1.08 · [#29](https://github.com/deagil/factory/pull/29) · `run(action, input, caller, { retryKey, dryRun })`, with decision 0021 and a partial unique index `action_log_retry_key_unique` on `(actor_id, retry_key)` for succeeded, non-dry-run rows. A retry key replays the earlier success (`replayed: true`); concurrent calls collide on the index and the loser replays, so the handler runs once (tested with two calls in `Promise.all`). Only successes are remembered, so a key can be retried after a failure; reuse for a different action or input is a `conflict`. A dry run rolls back after record and returns `changes` (its `audit_log` rows) plus one `action_log` row with `dry_run`. To run tests against a schema edit before `fx ship`, I generated a throwaway migration into `packages/db/migrations` and deleted it before committing.
- 2026-11-07 · P1.09 · [#30](https://github.com/deagil/factory/pull/30) · `generateDefinitions(object)` in `packages/actions/src/generated.ts`, with decision 0022. Inputs are flat (`update` is `{ id, version?, ...fields }`), outputs are `{ record }`, `get` gives `{ record, related }` and `list` the data access layer's page. `.updated` events carry `before` and `after`; a no-op update or a second archive succeeds with no event. Repository `not_found` maps to `not_found`; `conflict` and `archived` map to `conflict`. The generated file is held to the handler boundary like any action file.
- 2026-11-07 · P1.10 · [#31](https://github.com/deagil/factory/pull/31) · `createAuth({ db, secret, baseURL, sendCode })` in `packages/auth`, with decision 0023 and Better Auth 1.7 (the email OTP and bearer plugins). Better Auth's user is our `users` table (three new columns); its sessions, accounts and verifications are in an `auth` Postgres schema, so drizzle-kit's `schemaFilter` is now `public` and `auth` (the objects fixture generator too). Sign-up is off; disabled users are refused. Signing in finds or creates the staff actor (`staffActorFor` in `@workspace/db`, with a partial unique index on staff actors per user). `callerFrom(headers)` gives the pipeline's caller. Traps: Better Auth's verification ids aren't uuids, so that `id` is text; and Better Auth's `kysely` dependency gives the auth package a second drizzle-orm copy whose types clash, so auth imports no drizzle and its queries live in `@workspace/db`.
- 2026-11-07 · P1.11 · [#32](https://github.com/deagil/factory/pull/32) · `roleSchema`, `rolePermissions({ db, config })` and `grantedBy(roles)` in `packages/actions/src/permissions.ts`, with decision 0024. `ConfigService` gained `roles`. Generated definitions carry `objectPermission` (`view` for `.get`/`.list`); hand-written ones need `{ action: <name> }`. `*` works for objects and actions. The pipeline's `permissions` option is now `{ load(actor) }`, called once per run; its `Granted` answers both authorise and the data access layer's `canRead`. Unknown role keys in `actor_roles` grant nothing.
- 2026-11-07 · P1.12 · [#33](https://github.com/deagil/factory/pull/33) · Identity actions in `packages/auth/src/actions.ts` (`actor.createAgent`, `actor.createIntegration`, `apiKey.create`, `apiKey.revoke`), with decision 0025. Actions get `ctx.identity`, a narrow store over the identity tables bound to the run's transaction (from `@workspace/db`). Keys are `fx_…`, stored as SHA-256; `callerFrom` accepts them as bearer tokens and records `last_used_at`. Definitions can `redact` output keys from `action_log`. Agents get their user's permissions, narrowed by their own roles if they have any; only the agent's user can make its keys. Integrations get the roles they're created with.
- 2026-11-07 · P1.13 · [#34](https://github.com/deagil/factory/pull/34) · `createTransport({ registry, pipeline, callerFrom })` in `packages/server/src/transport.ts`, with decision 0026: our own generator on Hono won over oRPC. Every definition is a `POST /actions|queries/<name>` route, an OpenAPI operation (`z.toJSONSchema`) and an MCP tool. MCP is stateless: one `McpServer` and `WebStandardStreamableHTTPServerTransport` per request, built for that caller; `tools/call` works without `initialize`. oRPC validated input before the pipeline (skipping our errors and log rows), wrapped errors in its own envelope, needed casts for a runtime-built router and has no MCP, so it and its three dependencies are gone.
- 2026-11-07 · P1.14 · [#35](https://github.com/deagil/factory/pull/35) · `createApi({ registry, pipeline, callerFrom, authHandler })` in `packages/server`, with decision 0027. `POST /actions/<name>`, `POST`/`GET /queries/<name>` (`?input=` JSON), `?dryRun=true`, `Idempotency-Key` as the retry key, `X-Request-Id` echoed or generated. Errors are `{ error, actionId, requestId }` with status by code (approval_required is 202). Better Auth is served under `/auth`. Trap: `z.toJSONSchema` puts recursive parts (the list filter) in `$defs` with `#/$defs/` refs, which break inside an OpenAPI document; `openapi.ts` hoists them into `components/schemas`. The document is tested for resolvable refs and unique operation IDs, not with a full OpenAPI validator (that would be a new dependency). CI found a teardown race: pg-pool's `end()` resolves before its connections close, so `drop … with (force)` could kill one that had no error listener. `closeDb` now waits for every client's `remove` event.
