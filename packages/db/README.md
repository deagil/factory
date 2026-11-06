# @workspace/db

Drizzle setup, core tables, migration runner and, from phase 1, the schema check that compares the database with the object definitions.

Design: [docs/SYSTEM_DESIGN.md](../../docs/SYSTEM_DESIGN.md), section 3. Starting database schema.

## What's here

- `createDb(url)` returns a typed Drizzle database on its own `pg` pool; `closeDb(db)` closes it. There is no global `db`: services reach actions through `ctx` (AGENTS.md rule 7).
- `withTransaction(db, work)` runs `work` in one transaction, or a savepoint when called on a transaction. `Executor` is either.
- Core tables in `src/schema/core.ts`: `users`, `actors`, `actor_roles`, `api_keys`, `action_log`, `audit_log`, `event_log`. IDs default to Postgres 18's `uuidv7()`.
- `runMigrations(url)` applies `migrations/` with Drizzle's migrator. `pnpm db:migrate` (from the root) runs it against `DATABASE_URL`.
- `loadEnv()` loads the root `.env` without overriding the environment; `requireEnv(name)` fails with a fix-it message.

## Rules

- Migrations are generated, never written by hand. Until `fx ship` exists, run `pnpm --filter @workspace/db db:generate --name <change>`; after that, `fx ship` generates them.
- `audit_log` and `event_log` rows reference `action_log`, so the pipeline writes the `action_log` row first within its transaction.
