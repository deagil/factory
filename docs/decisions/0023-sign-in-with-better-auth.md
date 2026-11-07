# 0023. Sign-in with Better Auth, and where its tables live

- **Status:** Accepted
- **Date:** 2026-11-07

## Context

Phase 1 signs staff in with an emailed one-time code (SSO comes in phase 3), using Better Auth. Better Auth needs user, session, account and verification tables. The core already has `users`, and every action needs an actor. SYSTEM_DESIGN section 3 says Better Auth keeps its own tables in their own schema.

## Decision

- **Better Auth's user is our `users` table.** It gains `email_verified`, `image` and `updated_at` (all with defaults, so the migration only expands). One table holds people; nothing has to keep two in step.
- **Sessions, accounts and verifications are in the `auth` schema** (`auth.sessions`, `auth.accounts`, `auth.verifications`), written only by Better Auth. The schema check compares `public` only, so it ignores them; drizzle-kit's `schemaFilter` includes `auth` so `fx dev` and `fx ship` manage them.
- **Ids come from the database** (`generateId: false`, `uuidv7()` defaults), except verification ids, which Better Auth chooses itself and aren't uuids, so that column is `text`.
- **Sign-in is by emailed code** (Better Auth's email OTP plugin). Locally the code is printed to the server console. **Sign-up is off**: only users who already exist can sign in, since staff are added, not self-registered. Disabled users are refused when a session would be created.
- **Signing in finds or creates the user's staff actor**, in a hook after the session is created. A partial unique index on `actors (user_id) where kind = 'staff'` keeps it to one. This write is not an action: there is no actor yet to run one as. `isActiveUser` and `staffActorFor` in `@workspace/db` are the only code that does it.
- **`callerFrom(headers)`** turns a request's session (cookie, or `Authorization: Bearer` via Better Auth's bearer plugin) into the pipeline's caller: the staff actor, with the user as origin. The HTTP API (P1.14) calls it before `pipeline.run`.
- **`@workspace/auth` doesn't import drizzle-orm.** Better Auth brings in `kysely`, which makes pnpm give the package its own copy of drizzle-orm, whose types don't match `@workspace/db`'s. Queries the auth package needs live in `@workspace/db`.

## Consequences

- Adding a staff member is creating a `users` row (an action, from P1.11 on); their actor appears when they first sign in.
- SSO in phase 3 adds providers to the same Better Auth instance and rows to `auth.accounts`.
- `BETTER_AUTH_SECRET` must be set wherever the server runs.
