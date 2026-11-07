# 0031. `defineSystem`, `createServer` and running a system

- **Status:** Accepted
- **Date:** 2026-11-07

## Context

P1.18 makes the first runnable system, `examples/crm`. A system has objects, hand-written actions and roles; the core adds the rest. It has to run under `fx dev` against seeded data and pass its tests in CI. But `fx` and drizzle-kit so far only know the core schema in `packages/db`, and a system's tables share the change's database with it.

## Decision

- **`defineSystem({ name, objects, actions, roles })`** in `@workspace/server` validates the roles and builds the registry: each object's generated actions and queries, the identity actions, the hand-written ones, and `system.describe` (decision 0029). It also lists the object tables.
- **`createServer(system, { databaseUrl, authSecret, baseURL, trustedOrigins, sendCode })`** runs `assertSchema` on the core and object tables before anything else (decision 0016), then builds the pipeline with role permissions, Better Auth and the HTTP API (decision 0027). `listen(port)` serves it with `@hono/node-server`.
- **A system's schema:** its own `drizzle.config.ts` lists the core schema and its object file. Its `pnpm dev` pushes both to the change's database, then starts the server, so `fx dev`, which runs `turbo dev`, serves it. The core's drizzle config now has a `tablesFilter` of the core's own tables, so `fx dev`'s push of the core schema never drops a system's tables.
- **Object files import from `@workspace/objects/define`**, which exports only `defineObject` and `f`. drizzle-kit loads object files as CommonJS, where the rest of `@workspace/db` (which uses `import.meta`) fails.
- **Seeding:** people are created with `bootstrapStaff` in `@workspace/db` (a user, their staff actor and roles), because there is no actor yet to run an action as, like sign-in (decision 0023). Everything else in a seed goes through actions, with retry keys, so seeding twice changes nothing.
- **Tests:** `createObjectsDatabase(schemaFile)` in `@workspace/objects/testing/database` builds a test database from the core migrations plus a migration drizzle-kit generates for the system's objects. The CRM's tests run `checkSchema` on it, the contract across surfaces (decision 0030) and its hand-written action.

## Consequences

- Systems have no committed migrations yet: `fx ship` only writes the core's. Before a system is deployed, `fx` must generate and check a system's migrations too. That belongs with the client template (`templates/client`).
- Running `fx dev` from the root runs every package's `dev`, so the web app and the CRM start together.
- The first admin's email comes from the seed (`admin@example.com`); real systems will invite staff with an action.
