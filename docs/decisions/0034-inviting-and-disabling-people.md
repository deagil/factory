# 0034. Inviting people, setting roles, and disabling actors

- **Status:** Accepted
- **Date:** 2026-11-07

## Context

Phase 1 could make agents and integrations and their keys through actions (decision 0025), but people only came from seed data (`bootstrapStaff`, decision 0031), roles could only be granted when an actor was made, and nothing could switch an actor off. Sign-up is off (decision 0023), so an admin needs a way to add staff, change what anyone can do, and stop someone who has left, from the app and over MCP.

## Decision

- **People are invited, not signed up.** `user.invite` (name, email, roles) creates the user and their staff actor with those roles. The person signs in with a code sent to that email; there is no invitation email or token yet. An email already taken, compared without case, is a `conflict`.
- **`actor.setRoles` replaces an actor's roles.** Role keys must be in `config.roles`. An agent's roles must be among its person's staff roles: it acts for them and can only narrow what they can do (its permissions are already the intersection, so this keeps what the screen shows true). Nobody can change their own roles, so an admin can't lock themselves out by accident.
- **`actor.disable` and `actor.enable` switch an actor off and on.** A disabled actor can't act and its API keys are refused. Disabling a staff actor also disables its user, which ends their sessions and stops them signing in; their agents then get no permissions, and their agents' keys are refused. Enabling reverses both. Nobody can disable or enable themselves, or their own staff actor through one of their agents.
- **These are ordinary actions,** each needing the permission named after it, logged in `action_log`, in `packages/auth/src/actions.ts` beside the key actions. The writes go through the identity store on `ctx.identity`.
- Records are never deleted, and nor are people: disabling is the only way to remove someone.

## Consequences

- The Access screens (P1b.06) can do everything here through the same actions an agent would use.
- A request with a session whose staff actor is disabled gets no caller, even if the session somehow survives.
- Role changes take effect on the actor's next call, because permissions are loaded once per run.
- There's no self-service yet: a person can't narrow their own agent's roles without `actor.setRoles`. P1b.06 can add that if it's needed.
