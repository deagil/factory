# Phase 0: Foundations

**Goal:** the factory can build itself. A fresh clone installs and runs, every package has working checks, there is a local Postgres with the core tables, CI runs everything, and `fx start`, `fx dev` and `fx ship` handle a change from branch to PR.

**Out of scope:** objects, actions and screens (phase 1); config over git and the sync bot (phase 2); hosting and `fx release` (phase 3).

## Resume here

- **Status:** done.
- **Next:** phase 1, starting at P1.01 in [phase-1.md](phase-1.md). The known issues moved there.

## Tasks

### Workspace

- [x] **P0.01 Commit the starting point**
  - Commit the docs, decision records, placeholder packages and workspace changes currently in the working tree, using the message `docs: factory design, decisions and workspace structure`.
  - **Done when:** `git status` is clean on `main`, and the remote has it.

- [x] **P0.02 Pin the toolchain**
  - Set `engines.node` to `>=24` to match `.nvmrc`. Keep `packageManager: pnpm@11.25.0`.
  - Replace every `latest` version in `apps/web/package.json` with the version currently resolved in the lockfile, and change `@types/node` to `^24`.
  - Add a shared strict `tsconfig` base. Placeholder packages extend it, and `apps/web` keeps its own settings on top.
  - **Needs:** P0.01.
  - **Done when:** `pnpm install --frozen-lockfile` works on a clean clone, no dependency says `latest`, and `pnpm typecheck` passes for every package.

- [x] **P0.03 Lint, format and test in every package**
  - Every package and app has `typecheck`, `lint` and `test` scripts that Turborepo runs.
  - ~~Use the template's ESLint and Prettier.~~ Use Ultracite (Oxlint + Oxfmt) with one root config, at Dylan's request; see decision 0012.
  - Add a shared Vitest config to `packages/testing`, and give each placeholder package one test that passes.
  - **Needs:** P0.02.
  - **Done when:** `pnpm typecheck && pnpm lint && pnpm test` pass from the root, and a type or lint error in any package fails them.

### Database

- [x] **P0.04 Local Postgres**
  - Add a `docker-compose.yml` with Postgres 18 and a named volume, plus `pnpm db:up` and `pnpm db:down` scripts.
  - Add `DATABASE_URL` and `DATABASE_ADMIN_URL` to `.env.example`. The admin URL can create databases, which `fx` and the tests need.
  - Document the setup in the README quick start.
  - **Needs:** P0.01.
  - **Done when:** `pnpm db:up` gives a database reachable at `DATABASE_URL`, and the README steps work from a clean clone.

- [x] **P0.05 `@workspace/db`: connection and core tables**
  - Set up the Drizzle connection (node-postgres), a typed `db` export, a transaction helper, and the drizzle-kit config.
  - Define the core tables phase 1 needs: `users`, `actors`, `actor_roles`, `api_keys`, `action_log`, `audit_log` and `event_log` (columns in SYSTEM_DESIGN §3).
  - Leave out the approval, workflow, config and draft tables; they arrive with the phases that use them.
  - Generate and commit the first migration, and add a `pnpm db:migrate` script. Better Auth's tables come in P1.10, not here.
  - **Needs:** P0.03, P0.04.
  - **Done when:** `pnpm db:migrate` on an empty database creates the tables, `drizzle-kit generate` produces no new migration, and a test inserts and reads one `action_log` row.

- [x] **P0.06 Test databases**
  - `@workspace/testing` gets a `createTestDatabase()` helper. It creates a fresh database per test file from a migrated template database, and drops it afterwards.
  - Tests never touch the dev database.
  - **Needs:** P0.05.
  - **Done when:** two test files that write to the same table run in parallel without seeing each other's rows, and no test databases are left behind after a run.

### CI

- [x] **P0.07 CI pipeline**
  - Extend `.github/workflows/ci.yml` with a Postgres 18 service container, a frozen-lockfile install, Turborepo caching, and the typecheck, lint and test steps.
  - Add a migration check: apply all migrations to an empty database, then fail if `drizzle-kit generate` produces anything.
  - Add a migration lint: fail on destructive statements (`DROP`, `RENAME`, `ALTER ... TYPE`, `SET NOT NULL` on an existing column) unless the migration file is marked as a contract step. The rule is in SYSTEM_DESIGN §6.
  - **Needs:** P0.06.
  - **Done when:** CI is green on `main`, and a deliberate failing test, a forgotten migration and a `DROP COLUMN` each fail it.

- [x] **P0.08 Branch protection** _(Dylan, on the git host)_
  - No direct pushes to `main`; PRs need green CI. Write down how to set this up for GitHub and for a generic git host in `docs/`.
  - **Needs:** P0.07.
  - **Done when:** pushing straight to `main` is refused, and the setup is documented.
  - **Status:** documented in [docs/branch-protection.md](../branch-protection.md). Not enforced yet: `deagil/factory` is private on GitHub Free, where the API refuses rulesets and branch protection with `Upgrade to GitHub Pro or make this repository public`. Dylan decides: upgrade, or go public, then run the ruleset command and the push check in that doc.

### `fx`

- [x] **P0.09 `fx` skeleton and `fx status`**
  - `tools/fx` is a Node 24 CLI. Use the built-in `util.parseArgs` unless an agent-friendly CLI library is clearly worth adding; ask before adding a dependency.
  - Add a root `pnpm fx` script.
  - Keep the state of changes in `.fx/` (gitignored): one entry per change, with its name, branch, worktree path and database name.
  - `fx status` shows the current change, its branch and database, and whether checks last passed.
  - Every command takes `--json`, so agents can read the output reliably.
  - Design: SYSTEM_DESIGN §6 and §7.
  - **Needs:** P0.03.
  - **Done when:** `pnpm fx status` and `pnpm fx status --json` work in the repo, with tests for the argument parsing and the state file.

- [x] **P0.10 `fx start "<name>"`**
  - Creates the change in one step:
    - a branch `change/<slug>` from an up-to-date `main`;
    - a worktree under `../<repo>.worktrees/<slug>`;
    - a database `<repo>_<slug>`, cloned from a migrated template database;
    - the worktree's `.env` pointing at that database;
    - an entry in `.fx/`.
  - Refuses if the working tree has uncommitted changes, and says how to fix it.
  - **Needs:** P0.06, P0.09.
  - **Done when:** `fx start "try it"` leaves a worktree that passes `pnpm test` against its own database, and running it twice with the same name gives a clear error.

- [x] **P0.11 `fx dev`**
  - Runs the dev servers with the change's database. When the Drizzle schema changes, it pushes the schema to that database with `drizzle-kit push`, without writing migration files.
  - Prints which database it is using.
  - **Needs:** P0.10.
  - **Done when:** adding a column to a schema file shows up in the change's database within a few seconds while `fx dev` runs, and no migration file is created.

- [x] **P0.12 `fx ship`**
  - Rebases on `main`, then generates one migration for the change by diffing against `main`'s schema, and runs the migration lint. It then runs typecheck, lint and tests, and applies the migration to a fresh database.
  - If all of that passes, it pushes the branch and opens a PR. It uses `gh` when it's installed; otherwise it prints the compare URL.
  - Running `fx ship` again after more commits replaces the change's migration rather than adding a second one.
  - **Needs:** P0.07, P0.11.
  - **Done when:** a change that adds a column ships as one PR with exactly one new migration, CI passes, and a second `fx ship` still leaves one migration.

- [x] **P0.13 `fx switch` and `fx done`** _(stretch)_
  - `fx switch <name>` moves to another change's worktree.
  - `fx done` removes the worktree, database and state entry once the branch is merged, and refuses if it isn't merged.
  - **Needs:** P0.10.
  - **Done when:** after merging a change, `fx done` leaves no worktree, database or state behind.

### Exit

- [x] **P0.14 Phase exit check**
  - A fresh agent session, given only the repo, follows the README and `AGENTS.md`. It runs `fx start`, makes a trivial change with a schema edit, runs `fx ship`, and the PR goes green.
  - Fix whatever it trips over, update `AGENTS.md` and the README, and set phase 0 to Done in `docs/plans/README.md`.
  - **Needs:** all of the above except P0.13.
  - **Done when:** that run succeeds without help.

## Log

<!-- One line per finished task: YYYY-MM-DD · P0.xx · PR link · notes for the next person -->

- 2026-11-06 · plan written.
- 2026-11-06 · P0.01 · direct commit to `main` (no remote existed yet) · created private repo `deagil/factory` and pushed. Linting will use Ultracite instead of the template's ESLint (Dylan's request); see P0.03.
- 2026-11-06 · P0.02 · [#1](https://github.com/deagil/factory/pull/1) · shared config is `tsconfig.base.json` (NodeNext, `erasableSyntaxOnly`, `allowImportingTsExtensions`) so Node 24 can run package sources directly; use `.ts` extensions on relative imports. Workspace scripts use the root `tsc`, so packages don't each need `typescript`.
- 2026-11-06 · P0.03 · [#2](https://github.com/deagil/factory/pull/2) · Ultracite replaces ESLint and Prettier (decision 0012). Each package's `lint` is `ultracite check`; `pnpm format` fixes the whole repo. Shared Vitest config is `@workspace/testing/vitest`; packages devDepend on `@workspace/testing`, so `testing` must never depend on another workspace package or Turborepo sees a cycle.
- 2026-11-06 · P0.04 · [#3](https://github.com/deagil/factory/pull/3) · `postgres:18-alpine` with `max_connections=300` for per-file test databases; the named volume mounts at `/var/lib/postgresql` (Postgres 18 layout). `pnpm db:up` waits for the health check. `DATABASE_ADMIN_URL` points at the `postgres` maintenance database. `.env` (not `.env.local`) is the local env file.
- 2026-11-06 · P0.05 · [#4](https://github.com/deagil/factory/pull/4) · Drizzle 0.45 (stable; 1.0 is still beta) on `pg`. "Typed `db` export" is the `Db` type plus `createDb(url)`, not a global, so services come through `ctx`. IDs use Postgres 18 `uuidv7()`. Status/kind columns are text with TS enums, not check constraints, so widening them never needs a destructive migration. `audit_log`/`event_log` have FKs to `action_log`: P1.05/P1.07 must insert the `action_log` row first in the transaction. Retry-key uniqueness is left to P1.08. CI now has a Postgres 18 service, because the db test needs it; P0.07 adds the migration checks.
- 2026-11-06 · P0.06 · [#8](https://github.com/deagil/factory/pull/8) · `createTestDatabase()` clones `factory_template_<migrations hash>`, which is built on first use and is safe under parallel builders (build under a temporary name, then rename). The global teardown drops leftovers from the run. Templates for older migrations are never dropped automatically, because another worktree may be cloning from them; `fx done` (P0.13) should prune them. The shared Vitest config deletes `DATABASE_URL`. `@workspace/testing` applies `packages/db/migrations` by path, to stay a leaf package. Its own tests use `maxWorkers: 2`, so the isolation test can prove two files run at once on 2-CPU CI runners.
- 2026-11-06 · P0.07 · [#6](https://github.com/deagil/factory/pull/6) · Each CI check runs even if an earlier one failed, so one run shows every problem. Contract steps are marked with a first-line `-- contract-step: <why>` (decision 0013). The lint also refuses `TRUNCATE` and new `NOT NULL` columns without a default. `db:check-migrations` uses its own throwaway database, never `DATABASE_URL`. CI also fails if any `factory_test_*` database is left behind. Proof: draft [#11](https://github.com/deagil/factory/pull/11) had a failing test, a schema change with no migration and a `DROP COLUMN` migration. Test, Migration lint and the migrations check each failed on their own case, typecheck and lint passed, and the PR was closed.
- 2026-11-06 · P0.09 · [#7](https://github.com/deagil/factory/pull/7) · `pnpm fx` runs `tools/fx/src/cli.ts` with Node's type stripping; no build and no dependencies. `--json` output and errors go to stdout (pnpm's banner goes to stderr), with typed error codes and exit code 2 for usage errors. State is `.fx/changes/<slug>.json` in the main checkout, found from worktrees through `--git-common-dir`. `lastCheck` stays null until `fx ship` records results.
- 2026-11-06 · P0.10 · [#9](https://github.com/deagil/factory/pull/9) · `fx start` branches from `origin/main` after a fetch (local `main` if there's no remote). It clones the change database from the same migrations-hash template the tests use, via `@workspace/testing/databases`, a Vitest-free split of the test helpers. It runs `pnpm install` in the worktree and undoes earlier steps in reverse if any step fails. Tests drive it against a temporary repo with a bare origin; `--skip-install` exists for them.
- 2026-11-06 · P0.11 · [#10](https://github.com/deagil/factory/pull/10) · `fx dev` must run in a change's worktree. It pushes the schema with `drizzle-kit push --force` (a change database's data is disposable), then runs the worktree's `turbo dev --ui=stream` with `DATABASE_URL` set (turbo's `dev` task passes it through), then pushes again on every save under `packages/db/src/schema`. drizzle-kit exits 0 even when a push fails, so success is read from its output. `--reset` rebuilds the database empty and pushes the whole schema, which is the way past a rename. Turbo runs directly, in its own process group with no stdin, and always gets SIGTERM, once: pnpm's launcher drops some signals, and turbo leaves its tasks running if it gets a second one. Ctrl-C, and SIGTERM to the outer `pnpm`, the inner `pnpm` or fx itself, were each checked to stop everything. A column added while it ran reached the database in 2.5s, with no migration file.
- 2026-11-06 · P0.12 · [#15](https://github.com/deagil/factory/pull/15) · `fx ship` first takes out the migration commit an earlier ship wrote, found by its `Fx-Migration: <slug>` trailer. It then rebases on `origin/main` and refuses hand edits to `packages/db/migrations`. It writes the migration with `drizzle-kit generate --name <slug>` and commits it last, so a migration that lands on main first renumbers it instead of conflicting. Next it runs the migration lint, typecheck, lint, tests and `db:check-migrations`, stopping at the first failure, and records `lastCheck`. Finally it pushes with `--force-with-lease` and opens the PR with `gh pr create --fill-first`, so the first commit's subject is the title; without `gh` it prints a GitHub-style compare URL. `--contract-step "<why>"` writes the marker, and later ships keep it. A rename stops it with expand/contract advice instead of a prompt. `db:check-migrations` now also fails when drizzle-kit stops to ask; before, an unmigrated rename passed. Proof: a real `fx start` change shipped as [#14](https://github.com/deagil/factory/pull/14) with one migration and green CI. A second commit and ship still left one migration, now with both columns, and #14 was closed. Found on the way: oxfmt rejected drizzle-kit's JSON, so every new migration failed lint; fixed in [#13](https://github.com/deagil/factory/pull/13).
- 2026-11-06 · P0.13 · [#16](https://github.com/deagil/factory/pull/16) · `fx done` treats a branch as merged when its commits are in `origin/main`'s history, when merging it into main changes nothing (a squash merge, checked with `git merge-tree --write-tree`), or when `gh` reports a merged PR. It refuses unmerged or uncommitted work unless given `--force`, and deletes origin's branch only once merged. Afterwards it drops `factory_template_*` databases that neither the main checkout nor an open change uses. This is the pruning P0.06 deferred; a template still being built is left alone. `fx switch` prints the `cd`, or the bare path with `--path`, because a command can't move its shell. Tests use a real squash merge into a bare origin. `fx done ship-demo --force` cleared P0.12's closed demo and pruned two stale templates.
- 2026-11-06 · P0.08 · [#17](https://github.com/deagil/factory/pull/17) · Dylan made `deagil/factory` public, since GitHub Free can't protect a private repo. The `main` ruleset from [branch-protection.md](../branch-protection.md) is active. It blocks deletion and force pushes, requires a PR with the `check` status passing on an up-to-date branch, and allows only squash merges. It has no bypass actors, so admins are held to it too. The repo allows only squash merges, titled with the PR title. A direct push to `main` was refused with `GH013: Repository rule violations found`. This is the first change made with `fx start` and `fx ship`.
- 2026-11-06 · P0.14 · [#19](https://github.com/deagil/factory/pull/19) · A fresh agent, given only the repo, followed the README and AGENTS.md. It ran `fx start`, added a nullable `api_keys.expires_at` with a test, and ran `fx ship`. Its PR, [#18](https://github.com/deagil/factory/pull/18), went green without help, and was closed unmerged because the column was only a probe. Fixed what it tripped over:
  - the README said fx didn't exist yet, used a bare `fx`, and listed `fx release` but not `fx done`;
  - nothing said that tests fail after a schema edit until `fx ship` writes the migration;
  - the plans' branch naming rule contradicted fx's `change/<slug>`;
  - phase 0 was still listed as Not started;
  - `packages/db/README.md` was stale;
  - `pnpm test` showed a passing fx test's install failure as a red ×, so `fx start` now captures `pnpm install`'s output and shows it only if the install fails.

  AGENTS.md now has a Making a change section. Phase 1's plan was already written.
