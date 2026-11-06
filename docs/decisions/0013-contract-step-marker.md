# 0013. Marking a migration as the contract step

- **Status:** Accepted
- **Date:** 2026-11-06

## Context

Migrations expand, then contract (SYSTEM_DESIGN section 6, AGENTS.md rule 10). The migration lint refuses destructive statements unless the migration is "the marked contract step", but the design did not say how a migration is marked.

## Decision

- A migration is a contract step when its first line is a comment with a reason: `-- contract-step: <why it is safe now>`. A marker without a reason doesn't count.
- The lint (`pnpm db:lint-migrations`, run in CI) refuses these statements outside a contract step: `DROP` (except `DROP NOT NULL`), `RENAME`, changing a column's type, `SET NOT NULL`, `TRUNCATE`, and adding a `NOT NULL` column without a default.
- A contract step should contain only the contract: the drops and tightenings for code that has already stopped depending on the old shape.

## Consequences

- The reason sits next to the destructive SQL, where reviewers see it.
- drizzle-kit does not write the marker, so it has to survive regeneration. `fx ship` (P0.12) must keep the first line when it replaces a change's migration, or take the reason as an option.
- Adding a required column takes two changes: add it with a default or as nullable, backfill, then tighten it in a contract step.
