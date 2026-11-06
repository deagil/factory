# 0005. Objects are defined once with defineObject

- **Status:** Accepted
- **Date:** 2026-11-06

## Context

Record types need a table, migrations, validation, actions, screens and agent tools. Defining them in several places (as with splx's runtime tables and metadata registry) lets them drift.

## Decision

Every record type is one TypeScript `defineObject` that wraps Drizzle and returns a real Drizzle table. Validation, generated actions and queries, screens and agent tools derive from it; plain Drizzle is available through the `drizzle` option. Generated create, update and archive actions are on by default; a hand-written action for the same job switches the generated one off. Staff custom fields live in a `custom_fields` JSONB column. Permissions carry a scope from day one; version one supports only `all`.

## Consequences

- One source of truth for every table; CI fails on any table without a `defineObject`.
- A small field types library has to be built and maintained.
- Staff never trigger migrations.
