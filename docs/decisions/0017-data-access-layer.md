# 0017. How the data access layer lists, pages and follows refs

- **Status:** Accepted
- **Date:** 2026-11-06

## Context

The data access layer is the only way to read records (AGENTS.md rule 2). The generated `.get` and `.list` queries (P1.09), the web lists (P1.20) and agents all use it, so its input and output shapes become the API's. The design says it filters, sorts, pages, follows relations, hides archived records and applies permissions, but not how.

## Decision

- **One instance per reader.** `createDataAccess({ executor, canRead })` takes the database or the action's transaction, and a permission hook. Actions get it as `ctx.dal`.
- **The permission hook** answers, per object, `"all"` or `"none"`: phase 1's only scope, and no access at all. With `"none"`, a list is empty and `get` returns null, so a record's existence doesn't leak. Later scopes return a condition through the same hook.
- **List input** (`listInputSchema(object)`, strict):
  - `filter`: per field, an object of operators (decision 0014). `id`, `createdBy` and `updatedBy` take `eq`, `ne` and `in`; `createdAt` and `updatedAt` take `gt`, `gte`, `lt` and `lte` with ISO 8601 times.
  - `sort`: one key, with a leading `-` for descending. Text, number, money (by amount), date and boolean fields can be sorted on, and so can `createdAt` and `updatedAt`. The default is `-createdAt`, newest first. Ties are broken by `id` in the same direction, and empty values come last either way.
  - `cursor`: from the last page's `nextCursor`. It's opaque and tied to its sort; one from another sort is refused.
  - `limit`: 1 to 200, 50 by default.
  - `archived`: `exclude` (the default), `include` or `only`.
  - `expand`: ref fields to follow, one level deep.
- **Paging uses keyset cursors**, not offsets, so a page never repeats or skips a record when others are added.
- **Followed refs come back beside the records**, as `related[field][id]`, never inside them, so a record always matches its object's record schema. An `actor` ref shows `{ id, name, kind }`. Followed records include archived ones. A record the reader can't read is left out.
- **`get` hides archived records too**, unless asked with `archived: "include"`.
- **No raw SQL in the layer.** The one piece Drizzle's builder lacks, `NULLS LAST`, comes from `@workspace/db` (`ascNullsLast`, `descNullsLast`).

## Consequences

- Sorting by several keys, and full-text search, aren't there yet. Either can be added to the same input later.
- Sorting money by amount mixes currencies; a single-currency field (`f.money({ currency })`) avoids that.
- The input is plain JSON, so the HTTP API, MCP and the web app's URL state can all carry it as it is.
