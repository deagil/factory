# 0035. Restoring archived records, and archiving in the audit log

- **Status:** Accepted
- **Date:** 2026-11-07
- **Amends:** [0018](0018-audit-log-row-per-change.md), which said archiving writes no `audit_log` row.

## Context

Records are archived, not deleted, but phase 1 had no way back: an archived record was hidden from lists and nothing could bring it back. Staff need to find archived records and restore them, and a record's history needs to show when it was archived and restored. History is read from `audit_log` (decision 0018), and 0018 left `archived_at` out of it as a housekeeping column, so archiving showed only in `action_log`.

## Decision

- **Every object with a generated `.archive` also gets `<object>.restore`.** It clears `archived_at`, emits `<object>.restored`, needs the object's `archive` permission, and does nothing for a record that isn't archived. When a hand-written action owns archiving, or archiving is off, there's no generated restore either.
- **Archiving and restoring each write one `audit_log` row** with `archivedAt` in `before` and `after`: `null` to the time it was archived, or back. This amends 0018's rule for this one column. `updated_at`, `updated_by` and `version` are still never recorded.
- **Lists hide archived records unless asked.** The web list has "Show archived", which lists them with the rest and marks them. An archived record's screen says so, with Restore; it can't be edited, and its hand-written actions are hidden until it is restored.

## Consequences

- A record's History reads "archived it" and "restored it" from the same rows as every other change, so nothing else has to merge `action_log` into it.
- Filtering Activity → Changes by field `archivedAt` finds every archive and restore.
- Records archived before this change have no audit row for it; their `action_log` row still says what happened.
