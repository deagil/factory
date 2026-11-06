# 0018. One `audit_log` row per record change

- **Status:** Accepted
- **Date:** 2026-11-06

## Context

Decision 0007 put field history in the repository. The design then had one `audit_log` row per changed field: `field`, `old_value`, `new_value`. An action that changes a deal's stage and amount wrote two rows. Read back, those rows have to be grouped by `action_id` again to show one change on a record's timeline, and nothing in a row says which other fields moved with it.

## Decision

- **One row per record per action.** An update that changes two fields writes one row. A create writes one row. A no-op writes none.
- **`before` and `after` are separate JSONB columns.** Each holds only the fields that changed, keyed by field key; a field is in both or in neither. Custom fields use the key `customFields.<key>`, so they are diffed per key like any other field. A create has `before = {}` and `after` with every value that isn't null.
- **Values are in their record shape**: money as `{ amount, currency }`, dates as `YYYY-MM-DD`, refs as the id. They read like the record did at the time.
- **Housekeeping columns are never recorded.** `updated_at`, `updated_by`, `version` and `archived_at` are on the record already; archiving writes no `audit_log` row, and its `action_log` row says what happened.
- **A GIN index on `after`** finds every change to one field across records (`after ? 'stage'`).
- **Two columns, not one `changes` column of `{ field: [old, new] }`.** `after` alone answers "what did this set it to" and is what the index covers, and neither side needs unpacking.
- **Expand, then contract.** P1.05 adds `before` and `after` and makes `field` nullable; nothing writes `field`, `old_value` or `new_value`. P1.05a drops them as a contract step.

## Consequences

- A record's timeline is one `audit_log` row per entry, joined to `action_log` for the action's name and origin.
- "When did the stage last change" is `after ? 'stage'` on the record's rows, newest first, rather than a `field = 'stage'` match.
- The repository diffs with `isDeepStrictEqual`, so structured values (money) compare by value.
- Update results return the same `before` and `after`, so actions can use them in events without diffing again.
