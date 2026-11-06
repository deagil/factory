# 0009. Mid and back-end systems only

- **Status:** Accepted
- **Date:** 2026-11-06

## Context

Client projects often include a public website or booking form. Building customer-facing UI and customer logins into the core would add a second kind of user and a large surface.

## Decision

The core builds staff-facing systems and their integrations. Public websites and customer apps are separate front ends that call the API from their own servers as integration actors with scoped API keys, retry keys and webhooks. People who book or apply are records, not users.

## Consequences

- No customer UI or customer accounts in the core.
- The factory can still build a public site as a separate project against the generated SDK.
