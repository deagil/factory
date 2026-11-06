# 0015. defineObject's tables, records and registry

- **Status:** Accepted
- **Date:** 2026-11-06

## Context

Decision 0005 says every record type is one `defineObject` that returns a real Drizzle table. Section 3 of the system design lists the housekeeping columns. It doesn't say what a record looks like once it leaves the database, how a ref finds its target's table, or which indexes come without asking. The data access layer, repositories and every surface build on those answers.

## Decision

- **Housekeeping columns** are those in section 3: `id` (uuid v7), `created_at`, `updated_at`, `created_by` and `updated_by` (both referencing `actors`), `archived_at` and `version`. `custom_fields` (JSONB, default `{}`) is there only with `customFields: true`.
- **Table names** are the object name in snake case, made plural (`deal` → `deals`, `activity` → `activities`); `table` overrides it. An object can't take a core table's name.
- **Objects are registered by name, once per process.** Refs find their target's table through the registry, lazily, so two objects can point at each other whichever is defined first. A second object with the same name or table fails. Which objects a system serves is still `defineSystem`'s job (P1.18).
- **Indexes that come without asking:** one on every ref column, and a GIN index on `custom_fields`. Anything else goes in the `drizzle` option.
- **A record is JSON-safe.** Field values are as decision 0014 says, timestamps are ISO 8601 strings, and the object's `fromRow` builds a record from a row. The `record` schema checks one. Every surface sends records as they are.
- **Derived schemas are strict.** `create` needs the required fields and takes `null` or nothing for the rest. `update` takes any field except the read-only ones, and may be empty. Neither takes housekeeping columns or unknown keys.
- **Generated jobs:** `actions.create`, `.update` and `.archive` are on by default. `false` switches one off; an action name (`"booking.place"`) says which hand-written action owns the job, which also switches the generated one off.

## Consequences

- Schema files must load under drizzle-kit, which runs them as CommonJS. They and what they import can't use `import.meta`, so object code imports the core tables from `@workspace/db/schema`, not `@workspace/db`.
- Tests that define objects need names unique within their test file.
- The data access layer converts timestamps with `fromRow`, so no surface ever sees a `Date`.
