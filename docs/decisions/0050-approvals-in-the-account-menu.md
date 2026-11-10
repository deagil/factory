# 0050. Approvals live in the account menu

- **Status:** Accepted
- **Date:** 2026-11-10
- **Amends:** [0049](0049-navigation-lists-categories.md), whose header kept an Inbox section for Approvals.

## Context

The header lists the system's sections: kinds of records, definitions, logs, access and config (decision 0049). Approvals were a section of their own, Inbox. An approval is waiting for the signed-in person, the way My agents is theirs. It is not a category of the system the way Objects or the audit log is.

## Decision

- **Approvals leave the section menu.** The account menu holds them, above My agents, and only when `system.describe` says the caller can list approvals.
- The page stays at `/inbox/approvals`. It is no longer in a section, so its breadcrumb does not name one.

## Consequences

- The header no longer has an Inbox section. Config and Settings are unchanged.
- Someone who cannot list approvals does not see the item. My agents stays for everyone.
