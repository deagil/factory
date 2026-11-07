# Phase 1 handover

Written 2026-11-06, after P1.05a ([#25](https://github.com/deagil/factory/pull/25)). It's for whoever picks up phase 1 next, person or agent. The plan ([phase-1.md](phase-1.md)) is still the source of truth for tasks; this note covers what the plan's log doesn't put in one place: the shape of the code so far, how the work has been run, and the traps.

## Where things stand

The objects layer is done: P1.01 to P1.05a. Nothing above it exists yet. `packages/actions`, `auth`, `server`, `events`, `workflows`, `config` and `sdk` are still placeholders with a README.

| Task | PR | What it gave | Decision |
| --- | --- | --- | --- |
| P1.01 | [#20](https://github.com/deagil/factory/pull/20) | Field types: `f.text`, `number`, `money`, `date`, `boolean`, `ref` | 0014 |
| P1.02 | [#21](https://github.com/deagil/factory/pull/21) | `defineObject`: table, schemas, `toRow`/`fromRow`, registry | 0015 |
| P1.03 | [#22](https://github.com/deagil/factory/pull/22) | Schema check, run by `db:check-migrations` | 0016 |
| P1.04 | [#23](https://github.com/deagil/factory/pull/23) | Data access layer: `get`, `list`, keyset paging, refs, `canRead` | 0017 |
| P1.05 | [#24](https://github.com/deagil/factory/pull/24) | Repositories: `create`, `update`, `archive`; `audit_log` rows | 0018 |
| P1.05a | [#25](https://github.com/deagil/factory/pull/25) | Contract step dropping `audit_log`'s old per-field columns | 0018 |

The next task is **P1.06** (`defineAction`, `defineQuery` and the registry), then **P1.07** (the pipeline).

## What the next tasks build on

All of this is exported from `@workspace/objects` and `@workspace/db`.

- **Objects.** `defineObject({ name, fields, customFields?, list?, actions?, drizzle? })` gives `table`, `schemas.create` / `schemas.update` (without `readOnly` fields) / `schemas.record`, `toRow`, `fromRow`, `columnsOf`, `fieldLabels`, `list` and `actions` (`{ generated, ownedBy, readOnly }`). `getObject(name)` and `listObjects()` read the registry. Records are JSON-safe: timestamps are ISO strings, money is `{ amount, currency }` in minor units, dates are `YYYY-MM-DD`, refs are ids.
- **Reads.** `createDataAccess({ executor, canRead })`. `canRead(object)` answers `"all"` or `"none"`; P1.11 replaces the answer with real permissions. `listInputSchema(object)` is ready to be the `.list` query's input in P1.09.
- **Writes.** `createRepository({ executor, actionId, actorId, now })` throws unless `executor` is a transaction. `update` returns `updated` (with `before` and `after`), `unchanged`, `not_found`, `archived` or `conflict`; `archive` returns `archived`, `unchanged`, `not_found` or `conflict`. These map straight onto the typed errors P1.06 defines (`not_found`, `conflict`), and `before`/`after` are what `<object>.updated` events can carry.
- **History.** One `audit_log` row per record change, with only the changed fields in `before` and `after`, custom fields as `customFields.<key>` (decision 0018). Creates have `before = {}`. Archives write no row; their `action_log` row is the record.
- **Database.** `withTransaction(executor, work)`, `Executor` (a `Db` or a `Tx`), the core tables, `assertSchema` / `checkSchema` and `ascNullsLast` / `descNullsLast`. Raw SQL stays in `packages/db`.
- **Test database.** `createCrmDatabase()` in `packages/objects/src/test-fixtures/crm-database.ts` generates a migration for a small fixture CRM (`organisation`, `contact`) against the core migrations and applies it to a fresh database. `createStaffActor(db, name)` makes a user and staff actor. `repository.test.ts` has an `inAction` helper that does what P1.07 will: a transaction, an `action_log` row, then a repository bound to both.

## Things P1.06 and P1.07 have to settle

- **`ctx` is built per run.** The repository needs the `action_log` row's id, so `ctx.repo` can't exist before the pipeline has written that row inside the transaction. `ctx.dal` should use the same transaction, so an action reads its own writes.
- **`action_log` ordering and status.** `audit_log.action_id` is a foreign key, so the `action_log` row goes in first and is filled in at the record stage. `actionStatuses` has no in-flight value. Either add one (an expand migration) or insert with the expected final status and update it; write down the choice. A failed action's row is written again in its own transaction after the rollback (P1.07).
- **`packages/actions` dependencies.** It needs `@workspace/objects` and `@workspace/db` as workspace dependencies. The dependency direction is `actions` → `objects` → `db` (AGENTS.md rule 9).
- **Read-only fields** are enforced by the generated update action's input schema (P1.09), not by the repository, which will write any field it's given. Hand-written actions that own a field (`contact.moveToOrganisation`) rely on that.
- **P1.13's decision record** is the next free number: 0024 now that P1.06 to P1.10 took 0019 to 0023. The plan used to say 0012, which is the Ultracite decision.

## How the work has been run

- One task, one change, one PR: `pnpm fx start "P1.06 define action"` → work in `../factory.worktrees/<slug>` → commit → `pnpm fx ship --json` → bind the PR → wait for the user's go-ahead → `gh pr merge <n> --squash` → `pnpm fx done <slug>`. Nothing has been merged without the user saying so.
- Each PR ticks its task, adds a log line with the PR link (check `gh pr list --state all --limit 1` for the next number) and updates **Resume here**, in the same commit.
- The PR title and body come from the first commit, so that commit is written for a reviewer. Agents add the "Generated with Claude Code" line to the PR body afterwards with `gh pr edit`.
- `fx ship` takes a few minutes; run it in the background.
- A design change the user asks for mid-task (as with `audit_log`) gets a decision record, a reworded task in the plan and a log note saying it changed.

## Traps found so far

**drizzle-kit**

- It can't tell a rename from a drop and an add without a terminal prompt, and `fx ship` stops rather than guess. Reshape a table with expand then contract: add the new columns in one change and drop the old ones in a later change shipped with `fx ship --contract-step "<why>"` (decision 0013). P1.05 and P1.05a are the worked example.
- New `NOT NULL` columns need a default, or the migration lint refuses them.
- It loads schema files as CommonJS, so `import.meta` fails in them. Object schema files import core tables from `@workspace/db/schema`, not `@workspace/db`.
- Repeated `--schema` flags don't add up, and `--out` must be relative. `crm-database.ts` writes a temporary config for this reason.
- 0.31 drops and re-adds `actor_roles`' primary key on every push; harmless on a change database.
- Don't hand-edit `packages/db/migrations`; `fx ship` refuses it. To see what a schema edit would generate, run `drizzle-kit generate` into a copy and throw it away.

**Types**

- Ultracite rewrites `type X = { … }` as an interface, and interfaces don't satisfy `Record<string, …>`. Column maps are `Record` types (`MainColumn<…>`), and there are wide interfaces (`AnyField`, `AnyObjectDefinition`) for "any object".
- Field factories return `NoInfer<…>` types, or `required: true` inside a `fields` literal widens to `boolean`.

**Lint (Ultracite: Oxlint and Oxfmt)**

- Vitest: `toStrictEqual` rather than `toEqual`, `toBeTruthy`/`toBeFalsy`, at most five `expect`s per test, a message or pattern in every `toThrow`, no message argument to `expect`.
- Functions that capture nothing from their parent scope must move to module scope (`consistent-function-scoping`). Complexity at most 20. Named capture groups in regexes. No shadowing. No `await` inside loops without a disable comment and a reason.
- `pnpm exec ultracite fix <files>` fixes formatting and reports the rest.

**Environment**

- `fx start` refuses a dirty main checkout. Cursor writes `.cursor/hooks/state/`; it's excluded in `.git/info/exclude` on the original machine, but not gitignored. Gitignoring it is still an open small fix.
- macOS has no `timeout` command; don't wrap test runs in it.
- Records come back with timestamps as ISO strings, not `Date`s. Compare with `clock.toISOString()` in tests.

## Open questions for the user

- The `action_log` in-flight status (see above). It belongs in P1.07's decision record, but the user may have a view.
- Whether to gitignore `.cursor/`.
