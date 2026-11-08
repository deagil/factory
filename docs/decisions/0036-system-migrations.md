# 0036. System migrations

- **Status:** Accepted
- **Date:** 2026-11-08
- **Amends:** [0031](0031-define-system-and-create-server.md), which left systems without committed migrations.

## Context

Decision 0031 gave a system its tables through `drizzle-kit push` in development and a migration generated on the fly in its tests, but nothing committed. A system can't be deployed like that, and phase 2 adds columns to object tables (choice fields), so systems need migrations of their own before then. The core's migrations live in `packages/db/migrations` and every system shares them.

## Decision

- **A system keeps its own migrations, in its own drizzle journal,** at `<system package>/migrations`. Its `drizzle.config.ts` lists only the system's object file, with `out: "./migrations"` and a `tablesFilter` of the system's tables. drizzle-kit writes foreign keys to core tables such as `actors` without needing them in the schema.
- **System migrations apply after the core's** and are recorded in `drizzle.__drizzle_migrations_system`, next to drizzle's own table for the core's. `runMigrations(url, { system })` in `@workspace/db` applies both. One database holds one system, so the table name is fixed.
- **`defineSystem` takes `migrations`,** the folder's absolute path. A system's `start` applies the core's migrations and then its own before serving; under `pnpm dev` it doesn't, because the schema is pushed. Its tests use `createSystemDatabase(system)` from `@workspace/server/testing`, a test database built from both sets of migrations alone.
- **`fx ship` writes one migration for each schema that changed,** the core's and each system package's (a package whose `package.json` has `factory.system` and that has a `drizzle.config.ts`), all with the change's slug as the name and all in the one `Fx-Migration` commit. It refuses hand edits to any of those folders, and `--contract-step` marks every migration it writes.
- **The checks run per package.** The root `db:lint-migrations` and `db:check-migrations` run the script of that name in every package that has one. A system's scripts call `@workspace/db`'s with its folder; `check-migrations` reads the system's drizzle config to find its schema and migrations.
- **Drizzle Studio** uses a separate config that adds the core schema, so it still shows every table.

## Consequences

- A system is now deployable from its migrations, and CI builds the CRM's database from migrations alone, in its tests and in `db:check-migrations`.
- `createObjectsDatabase` stays for the fixture objects in `@workspace/objects`, which aren't a system.
- A client repo (phase 3) has the same shape: the core's migrations come with the pinned packages, and the client's are in its own package.
