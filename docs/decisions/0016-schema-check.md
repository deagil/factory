# 0016. What the schema check compares

- **Status:** Accepted
- **Date:** 2026-11-06

## Context

The schema check (SYSTEM_DESIGN section 6, Guardrails) runs at start-up and in CI. It fails when the database doesn't match the object definitions and core tables, or holds a table that came from neither (AGENTS.md rule 3). Migrations expand and then contract (rule 10), so for a while the database legitimately holds more than the code uses. DBOS and Better Auth keep their own tables.

## Decision

- **Scope:** tables in the `public` schema. DBOS, Better Auth and Drizzle's migration journal live in their own schemas and are ignored.
- **It fails on:**
  - a table the code defines that the database lacks;
  - a column the code defines that the database lacks;
  - a column whose type differs, compared as Postgres's `format_type` prints it;
  - a column whose nullability differs;
  - a table in `public` that the code doesn't define.
- **It allows** columns the database has and the code doesn't use, and lists them, because code stops using a column before a contract step drops it.
- **It doesn't compare** defaults, indexes, constraints or foreign keys. Migrations come from the same definitions, and `db:check-migrations` already fails when the schema has changes with no migration.
- **Every message says what to do:** run the migrations, let `fx ship` write the missing migration, or define the table with `defineObject` or drop it in a contract step.
- **Where it runs:** `checkSchema(db, tables)` and `assertSchema` live in `@workspace/db`, because they read the catalog. The caller passes the expected tables: `coreTables` plus every object's table. `db:check-migrations` runs it on a freshly migrated database in CI, and `createServer` (P1.18) runs `assertSchema` at start-up.

## Consequences

- Removing a column is two deploys. The code stops using it first, which the check allows and lists, and a later contract step drops it.
- Removing an object cannot be split that way. A table the code still defines and the database lacks fails the check, and so does a table the code no longer defines. The contract step that drops the table and the code that stops defining the object land in the same change.
- A raw table for something outside the core, such as a reporting table, needs `defineObject` or its own schema.
