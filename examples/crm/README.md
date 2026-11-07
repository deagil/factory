# Example system: CRM

Organisations and contacts, with one hand-written action, `contact.moveToOrganisation`, which owns a contact's organisation and emits `contact.moved`. Roles: `admin`, `sales` and `support`.

Used to design and test the core, and as a starting point for real clients. Deals, activities and CSV import come later.

## Run it

From a change's worktree (`pnpm fx start "…"`):

```bash
pnpm fx dev
```

`fx dev` runs every package's `dev`. This one pushes the core and CRM schema to the change's database, seeds it, and serves on <http://localhost:4000>:

- the HTTP API: `POST /actions/<name>`, `POST`/`GET /queries/<name>`, and `/openapi.json`;
- sign-in under `/auth` (codes are printed to the console). The web app on <http://localhost:3000> proxies `/auth` and `/api` here, so sign in there;
- MCP at `/mcp`. The first run prints an agent key for `admin@example.com`. Connect Claude Code with it:

```bash
claude mcp add --transport http factory-crm http://localhost:4000/mcp --header "Authorization: Bearer <agent key>"
```

Seed data: `admin@example.com` (admin), `sarah@example.com` (sales), `sam@example.com` (support: contacts only), three organisations and four contacts.

## Files

- `src/objects.ts`: the objects, imported only from `@workspace/objects/define` so drizzle-kit can load it.
- `src/move-to-organisation.ts`: the hand-written action.
- `src/roles.ts`, `src/system.ts`: `defineSystem`.
- `src/seed.ts`, `src/main.ts`: seed data and the server.
- `drizzle.config.ts`: the core schema plus the objects, for `pnpm dev`.

See decision [0031](../../docs/decisions/0031-define-system-and-create-server.md).
