# 0025. API keys, agents and integrations

- **Status:** Accepted
- **Date:** 2026-11-07

## Context

Agents (Claude Code over MCP) and integrations (a client's website) call the API with keys. Decision 0011 says agents act for a person with no more than that person's permissions, and integrations are scoped to what they're allowed. Creating and revoking keys must be actions, but `actors`, `actor_roles` and `api_keys` are core tables, not objects, so repositories don't write them, and handlers can't reach the database.

## Decision

- **`ctx.identity`** is a narrow service on the action context, bound to the run's transaction: get and create actors, grant roles, create, get and revoke API keys. The core's identity actions use it: `actor.createAgent`, `actor.createIntegration`, `apiKey.create` and `apiKey.revoke` in `@workspace/auth`. They need permissions on their names like any hand-written action.
- **Keys** are `fx_` plus 32 random bytes in base64url. Only a SHA-256 hash is stored. `callerFrom(headers)` treats `Authorization: Bearer fx_…` as a key, refuses revoked keys and disabled actors, and records `last_used_at` (bookkeeping, outside any action). A key for an agent gives the agent as actor and its user as origin; an integration has no origin user.
- **Secrets never reach `action_log`.** A definition can list output keys to `redact`; the caller gets the value once and the row stores `"[redacted]"`. `apiKey.create` redacts `key`. A replay with the same retry key returns the redacted value, so a lost key means a new key.
- **An agent's permissions are its user's.** `rolePermissions` gives an agent its user's staff actor's permissions, narrowed by the agent's own roles if it has any. A disabled user's agents can do nothing. Only the user an agent acts for can create its keys, since a key acts as that user.
- **An integration's permissions are its roles**, given when it's created. A role listing only the actions a website needs is the scope.

## Consequences

- An agent with no roles of its own can do everything its user can; narrowing is opt-in.
- Removing a role from a user narrows their agents at once.
- Rate limiting integrations (SYSTEM_DESIGN section 4.3) is still to do; it belongs in the HTTP layer.
