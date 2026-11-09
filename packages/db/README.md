# @workspace/db

Drizzle setup, core tables, migration runner and, from phase 1, the schema check that compares the database with the object definitions.

Design: [docs/SYSTEM_DESIGN.md](../../docs/SYSTEM_DESIGN.md), section 3. Starting database schema.

## What's here

- `createDb(url)` returns a typed Drizzle database on its own `pg` pool; `closeDb(db)` closes it. There is no global `db`: services reach actions through `ctx` (AGENTS.md rule 7).
- `withTransaction(db, work)` runs `work` in one transaction, or a savepoint when called on a transaction. `Executor` is either.
- Core tables in `src/schema/core.ts`: `users`, `actors`, `actor_roles`, `api_keys`, `runs`, `run_steps`, `audit_log`, `event_log` (and phase 1's `action_log`, unwritten since P2.12). IDs default to Postgres 18's `uuidv7()`. `@workspace/db/schema` exports only these tables, for schema files that drizzle-kit loads as CommonJS, where the rest of the package (which uses `import.meta`) fails.
- `runMigrations(url, { system })` applies `migrations/` with Drizzle's migrator, then a system's own migrations folder when one is given (decision 0036). `pnpm db:migrate` (from the root) applies the core's against `DATABASE_URL`.
- `checkSchema(db, tables)` compares the database's `public` tables with `tables` (pass `coreTables` and every object's table) and returns the problems, each with a message saying what to do. `assertSchema` throws them as a `SchemaCheckError`, for start-up. Unused columns are allowed. See decision 0016.
- `loadEnv()` loads the root `.env` without overriding the environment; `requireEnv(name)` fails with a fix-it message.

## Rules

- Migrations are generated, never written by hand. `fx ship` writes each change's migrations: one for the core and one for each system whose schema changed.
- `pnpm db:lint-migrations` refuses destructive statements unless the migration's first line is `-- contract-step: <why>` (decision 0013). `pnpm db:check-migrations` applies every migration to an empty database, runs the schema check on it, then fails if the schema has changes with no migration. Given a system package's folder, both check that system's migrations, applied after the core's; the root scripts run them for the core and every system.
- `audit_log` and `event_log` rows reference a run and its step, so the pipeline writes the `runs` and `run_steps` rows first within its transaction; a failed run's rows are written after the rollback (decision 0046).
- `audit_log` has one row per record change, with the changed fields in `before` and `after` (decision 0018).
