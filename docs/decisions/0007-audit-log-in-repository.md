# 0007. Field history in the repository, not triggers

- **Status:** Accepted
- **Date:** 2026-11-06

## Context

Every object needs field-level history. Database triggers would capture it but hide logic in the database, lack context about who acted and why, and sit outside the action pipeline.

## Decision

The repository writes `audit_log` rows inside the action pipeline: it reads the current row, applies the change, works out which fields changed, and writes history, the `action_log` entry and `event_log` rows in one transaction. The API's database role is the only writer; backfills run as actions under the automation actor.

## Consequences

- History knows the actor, who they acted for and the action.
- Writes that bypass the repository are not recorded, so bypassing it is not allowed.
