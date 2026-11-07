# Example system: CRM

Organisations and contacts, with one hand-written action, `contact.moveToOrganisation`, which owns a contact's organisation and emits `contact.moved`. Roles: `admin`, `sales`, `support` and `website` (for the website integration).

Used to design and test the core, and as a starting point for real clients. Deals, activities and CSV import come later.

## Run it

From a change's worktree (`pnpm fx start "…"`):

```bash
pnpm fx dev
```

`fx dev` runs every package's `dev`. This one pushes the core and CRM schema to the change's database, seeds it, and serves on <http://localhost:4000>:

- the HTTP API: `POST /actions/<name>`, `POST`/`GET /queries/<name>`, and `/openapi.json`;
- sign-in under `/auth` (codes are printed to the console). The web app on <http://localhost:3000> proxies `/auth` and `/api` here, so sign in there;
- MCP at `/mcp`. The first run prints an agent key for `admin@example.com`, and a key for the "Website" integration, which may only create organisations. Connect Claude Code with the agent key:

```bash
claude mcp add --transport http factory-crm http://localhost:4000/mcp --header "Authorization: Bearer <agent key>"
```

Call the API with the integration key:

```bash
curl -X POST http://localhost:4000/actions/organisation.create -H "Authorization: Bearer <integration key>" -H "content-type: application/json" -d '{"name":"Signed up online"}'
```

Seed data: `admin@example.com` (admin), `sarah@example.com` (sales), `sam@example.com` (support: contacts only), the Claude agent and the Website integration, three organisations and four contacts.

## Files

- `src/objects.ts`: the objects, imported only from `@workspace/objects/define` so drizzle-kit can load it.
- `src/move-to-organisation.ts`: the hand-written action.
- `src/roles.ts`, `src/system.ts`: `defineSystem`.
- `src/seed.ts`, `src/main.ts`: seed data and the server.
- `drizzle.config.ts`: the core schema plus the objects, for `pnpm dev`.

See decision [0031](../../docs/decisions/0031-define-system-and-create-server.md).
