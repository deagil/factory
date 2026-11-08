# Phase 1b: Web surface

**Goal:** everything phase 1 built can be used and tested from the web app, by a developer and by a client's staff. Navigation moves up a level, from a list of objects to the system's functions in sections (Data, Activity, Access, Settings). Each log gets its own screen, not only a record's History tab. People, agents, integrations, roles and keys can be managed without the seed. The local dev bar gets the tools for working on the factory itself. At the end, an admin can follow an organisation created three ways (web, MCP, `curl`) through Activity without opening Drizzle Studio, and set up a new agent key from the browser.

**Out of scope:**

- The agent chat. The sidebar is kept for it, but it comes with the in-app agent (phase 4).
- Config editors, drafts, the approvals inbox, workflows and the run inspector (phase 2, P2.10 and P2.14). Their sections are planned here so they slot in without moving anything.
- Scopes beyond `all`, reports and the page builder (later).

## Resume here

- **Status:** done. Phase 2 is next: see [phase-2.md](phase-2.md).
- **Next task:** none.
- **How to start:** see [docs/plans/README.md](README.md) and AGENTS.md. Every change goes through `pnpm fx start` → `pnpm fx ship` → `pnpm fx done`. The CRM's seeded users are Admin (`admin@example.com`, admin), Sarah (`sarah@example.com`, sales) and Sam (`sam@example.com`, support).

## Decisions for this phase

These fill gaps until later phases replace them. Don't build further than this.

- **Navigation is in the main pane's header; the sidebar is kept for the agent chat.** The header has three rows: sections (a Navigation Menu whose panels list each section's pages with a line of description), a breadcrumb trail from the section down, and the page title with its actions. The account menu moves into the header.
- **Sections and pages:** Data (one page per object), Activity (Actions, Changes, Events), Access (Users, Agents, Integrations, Roles), Settings (Reference, API & MCP). Phase 2 adds Inbox, Automation and Settings → Config. A page shows only when `system.describe` lists the query it needs; a section with no pages is hidden.
- **App navigation and the dev bar don't mix.** If a client's admin would need it on a deployed system, it goes in the app behind a permission. If it only makes sense against a local dev server or the factory repo, it goes in the dev bar. The dev bar never changes data except through actions or sign-in, as the signed-in user.
- **Logs are read through the data access layer** by hand-written queries in `@workspace/actions`, each needing a permission on its own name. Everyone can read their own actions (as actor or origin user) without it.
- **Staff are invited, not signed up.** `user.invite` creates the user and their staff actor with roles; they then sign in with a code. Sign-up stays off.

## Tasks

### Shell (`apps/web`)

- [x] **P1b.01 Header navigation and breadcrumbs**
  - Add shadcn's Navigation Menu to `packages/ui`. Sections and their pages are a typed list in `apps/web/src/lib/nav.ts`; each page names the query it needs, and `navFrom(description)` keeps the pages and sections the caller can use. Object pages take their description from `system.describe`.
  - Breadcrumbs come from route `staticData` (section and page), and the screen gives the last crumb through `PageHeader`. They replace the back links.
  - The account menu (email, sign out) moves to the header. The sidebar keeps its open, close, resize and side controls and holds an empty agent panel.
  - On narrow screens the sections collapse into one menu button.
  - Write a decision record for the navigation and the dev bar boundary.
  - **Needs:** nothing.
  - **Done when:** Sam sees only Data › Contacts, the admin sees every section that has pages, a record screen shows `Data › Contacts › Ada Lovelace`, and nothing navigates from the sidebar.

### Activity (SYSTEM_DESIGN §4.8)

- [x] **P1b.02 Log queries**
  - `dal.actions` (filter by actor, action name or prefix, status, dry run and time; newest first; cursor paging), `dal.action(id)` with its `audit_log` and `event_log` rows, `dal.changes` (by object, record, field via `after ? field`, actor and time) and `dal.events` (by type, action and time). Rows name their actor and origin user.
  - Queries `actionLog.list`, `actionLog.get`, `auditLog.list` and `eventLog.list`, added by `defineSystem`. Each needs a permission on its own name; without it, `actionLog.list` and `actionLog.get` return only the caller's own actions (as actor or origin user) and the others are forbidden.
  - **Needs:** nothing.
  - **Done when:** tests cover each filter, paging, the own-actions rule and a forbidden caller, and an agent's action shows the agent as actor and its user as origin.

- [x] **P1b.03 Activity screens**
  - Activity → Actions: a filterable list (filters in the URL, like the object lists) and an action screen with input, result or error, status, retry key, dry run, `config_sha`, actor and origin, and the changes and events it caused, each linking to its record.
  - Activity → Changes and Activity → Events: filterable lists linking to their action and record.
  - A record's History entries link to their action.
  - **Needs:** P1b.01, P1b.02.
  - **Done when:** in the browser, the admin finds an organisation created over MCP by filtering Actions by actor, opens it, and follows it to the record; Sarah sees only her own actions.

### Access (SYSTEM_DESIGN §4.3)

- [x] **P1b.04 Identity queries**
  - `actor.list` (by kind and status, with user email and roles), `actor.get` (with roles and keys), `apiKey.list` (by actor; label, created, last used, revoked; never the hash) and `role.list` (from `ConfigService`, with permissions).
  - P2.07's actor picker uses `actor.list`.
  - **Needs:** nothing.
  - **Done when:** tests cover each query and its permission, and no query returns a key hash.

- [x] **P1b.05 Identity actions**
  - `user.invite` (name, email, roles: makes the user and their staff actor), `actor.setRoles` (an agent's roles can only narrow its user's), `actor.disable` and `actor.enable` (a staff actor's user too). You can't disable yourself. Write a decision record.
  - **Needs:** P1b.04.
  - **Done when:** an invited user signs in with a code and has the invited roles, a disabled user can't sign in and a disabled actor's keys are refused, and each action leaves an `action_log` row.

- [x] **P1b.06 Access screens**
  - Access → Users, Agents and Integrations: lists and an actor screen with roles (editable with `actor.setRoles`), keys (create, shown once; revoke) and a link to the actor's actions. Invite and create buttons use the actions' input schemas.
  - Access → Roles: each role's permissions as a table of objects, verbs and actions.
  - Account menu → My agents: your agents and their keys, and "Connect an agent", which makes an agent and a key and shows the `claude mcp add` command for this system.
  - **Needs:** P1b.01, P1b.05.
  - **Done when:** in the browser, the admin invites a user who then signs in, and Sarah connects an agent whose key works over MCP.

### Data

- [x] **P1b.07 Archived records**
  - A generated `<object>.restore` action that clears `archived_at` and emits `<object>.restored`, with the `archive` permission. Lists get a "Show archived" option; an archived record shows a banner with Restore.
  - **Needs:** P1b.01.
  - **Done when:** a record archived from the web can be found and restored, and history shows both.

### Settings (SYSTEM_DESIGN §4.9)

- [x] **P1b.08 Reference and API & MCP**
  - Settings → Reference from `system.describe`: objects and their fields, actions with their input and events, queries and events, each with its schema.
  - Settings → API & MCP: the OpenAPI document, the MCP endpoint, how to authenticate, and a link to My agents.
  - **Needs:** P1b.01.
  - **Done when:** the admin can find `contact.moveToOrganisation`'s input and events in Reference, and Sam's Reference lists only what he can use.

### Dev bar (`apps/web/src/dev`)

- [x] **P1b.09 Session tools**
  - Locally only, the server keeps the last sign-in codes it printed in a dev outbox, at a route that doesn't exist in production. The dev bar's Session menu signs in as any seeded user through the normal code flow, and shows the outbox.
  - **Needs:** nothing.
  - **Done when:** switching between Admin, Sarah and Sam takes one menu choice each, and a production build has neither the route nor the menu.

- [x] **P1b.10 API and inspection tools**
  - An API menu: recent calls with status, request id and action id (linking to Activity), "Send actions as dry runs", added latency, and "Fail the next call with…" for each typed error.
  - An Inspect menu: TanStack Query and Router devtools on or off, and the raw `system.describe`.
  - The Factory menu shows the change, branch and database the dev server runs on.
  - **Needs:** P1b.03.
  - **Done when:** with dry runs on, creating a record shows the dry-run result and changes nothing, and a forced `conflict` shows the form's conflict message.

### Exit

- [x] **P1b.11 Phase exit demo**
  - In `examples/crm`, create an organisation from the web, over MCP with an agent key made in My agents, and with `curl` and an integration key made in Access. Follow all three through Activity as the admin, and check Sarah and Sam see only what they should.
  - Update SYSTEM_DESIGN §4.9, AGENTS.md's current state and the README status, set this phase to Done in `docs/plans/README.md`, and point phase 2's Resume here at P2.01.
  - **Needs:** all of the above.
  - **Done when:** the demo works end to end from a fresh worktree.

## Log

<!-- One line per finished task: YYYY-MM-DD · P1b.xx · PR link · notes for the next person -->

- 2026-11-07 · plan written, from a review of phase 1's features against the web app.
- 2026-11-07 · P1b.01 · [#54](https://github.com/deagil/factory/pull/54) · Sections in the header, with decision 0033. `navFrom(description)` in `apps/web/src/lib/nav.ts` returns sections of pages (only Data so far); a new section is an entry there with its `SectionKey` and `NavLink` route. Routes set `staticData: { section }` (typed in `router.tsx`), and screens pass `trail` to `PageHeader` instead of a back link; the title is the breadcrumb's last step, so it isn't repeated. Navigation Menu and Breadcrumb are shadcn's, in `packages/ui` (the breadcrumb page's `role="link"` was dropped for lint). The account menu is in the header; the sidebar is the agent's placeholder. Checked in the browser: the admin's Data panel lists Organisations and Contacts with their descriptions, a contact reads `Data › Contacts` above its name, Sam's panel has only Contacts, and at phone width the sections are one Menu dropdown. To run a change's servers beside main's, I used ports 4100 and 3100 (`PORT`, `BETTER_AUTH_URL`, `API_URL`, `vite --port`).
- 2026-11-07 · P1b.02 · [#55](https://github.com/deagil/factory/pull/55) · `dal.actions`, `dal.action`, `dal.changes` and `dal.events` in `packages/objects/src/dal/logs.ts`, returned by `createDataAccess` alongside `get`, `list` and `history`. Entries are JSON-safe with ISO times, name their `actor` and `origin` user, and page by an opaque `(at, id)` cursor, newest first. The field filter is `after ? field` through `jsonbHasKey` in `@workspace/db`, so it uses `audit_log`'s GIN index. The queries are in `packages/actions/src/logs.ts`, with their output schemas in `log-schemas.ts` (they need the core's action statuses, and query files may not import `@workspace/db`). `actionLog.list` and `actionLog.get` are `everyone: true` and narrow to the caller's own actions (as actor, or as origin user, so a person sees their agents' actions) unless the caller holds the permission named after the query; the other two need their permission. `defineSystem` registers all four, so the CRM's admin (`action: "*"`) has them and Sarah and Sam have only their own actions.
- 2026-11-07 · P1b.04 · [#56](https://github.com/deagil/factory/pull/56) · `dal.actorList`, `dal.actorDetail` and `dal.apiKeyList` in `packages/objects/src/dal/identity.ts` (paging shared with the logs). Entries carry the actor's user (with email and status) and role keys; keys carry label, created, last used and revoked, never the hash. `actor.list`, `actor.get` and `apiKey.list` (`packages/actions/src/identity-queries.ts`) follow the logs' rule: everyone, narrowed to your own staff actor and agents without the permission named after the query. Integrations and automations, which belong to no user, see an empty list. `role.list` returns `config.roles` and needs its permission. Schemas are in `identity-schemas.ts` for the same boundary reason as the logs'.
- 2026-11-07 · P1b.03 · [#57](https://github.com/deagil/factory/pull/57) · Activity → Actions, Changes and Events in `apps/web/src/routes/_app/activity.*.tsx`, with an action screen at `/activity/actions/$id`; shared pieces (who did it, status, record and action links, changed fields by label, JSON, filters, pager) are in `components/activity.tsx`. `navFrom` adds each page only when `system.describe` lists its query. Filters and the page are in the URL; clicking an actor filters by them, shown as a removable chip. A record link uses the record's title from the change, else the object and the end of its id (UUIDv7 ids share their start). A record's History entries link to their action. Fixed on the way: `actor.list` (P1b.04) broke the record form's ref picker, which took every `<target>.list` for an object list; refs to `actor` now list active staff through `actor.list`, so Account owner is a picker. Checked in the browser: the admin filtered Actions by Claude, opened the `organisation.create` it ran over MCP and followed it to Umbrella Corp; Sarah sees only her own action, and her Activity menu has only Actions.
- 2026-11-07 · P1b.05 · [#58](https://github.com/deagil/factory/pull/58) · `user.invite`, `actor.setRoles`, `actor.disable` and `actor.enable` in `packages/auth/src/actions.ts`, with decision 0034. The identity store gained `createUser` (null for a taken email), `createStaffActor`, `staffActorOf`, `rolesOf`, `setRoles`, `setActorStatus` and `setUserStatus` (disabling deletes the user's sessions). `actor.setRoles` checks role keys against `config.roles`, keeps an agent's within its person's staff roles, and refuses your own. Disabling a staff actor disables its user too; `callerFrom` now refuses a session whose staff actor is disabled, and `actorForApiKey` refuses an agent's key when its person is disabled. All four need their permission; nobody can disable or re-role themselves. Tests in `packages/auth/src/people.test.ts` sign in with a code: an invited person has the invited roles, a disabled one can't sign in, their old session and their agent's key are refused, and enabling lets them back in.
- 2026-11-07 · P1b.07 · [#59](https://github.com/deagil/factory/pull/59) · `repo.restore` and a generated `<object>.restore` (with `.archive`, needing the `archive` permission, emitting `<object>.restored`). Archiving and restoring now each write an `audit_log` row for `archivedAt`, amending decision 0018 in decision 0035, so History shows "archived it" and "restored it". The list has "Show archived" (`?archived=true`, sent as `archived: "include"`) and marks archived rows; the record screen loads with `archived: "include"`, stays put after Archive, and shows a banner with Restore, with editing and hand-written actions hidden while archived. `customActions` treats `restore` as generated. History now names actor refs (Account owner) through `actor.get`. Checked in the browser: the admin archived Globex, found it with Show archived, restored it, and its History reads created, archived, restored.
- 2026-11-07 · P1b.06 · [#60](https://github.com/deagil/factory/pull/60) · Access → Users, Agents, Integrations and Roles, an actor screen at `/access/actors/$id`, and My agents at `/account/agents` (in the account menu). Since everyone can list their own actors, each Access page waits for an action only access managers hold (`user.invite`, `actor.setRoles`, `actor.createIntegration`; Roles needs `role.list`). Shared pieces are in `components/access.tsx`: `ActorListScreen`, `ActionForm` (built from the action's input schema in `system.describe`: text or email inputs, and a role picker for `roles`), `RolePicker`, `KeyList` (New key shows the key once; Revoke) and `KeyReveal`. The actor screen edits roles with `actor.setRoles`, disables or enables (not yourself), lists keys (only an agent's own person can make its keys), and links to its actions in Activity. Connect an agent runs `actor.createAgent` then `apiKey.create` and shows `claude mcp add --transport http <name> <origin>/mcp --header "Authorization: Bearer <key>"` (`lib/mcp.ts`); the web app's dev server now proxies `/mcp` too (decision 0032). Checked: in the browser the admin invited Priya with Sales from Users, and her actor screen and Roles show it; Priya then signed in with a code (through the web app's `/auth`, from the terminal) with Sales' actions. As Sarah, the two actions Connect runs made an agent and key that worked over `localhost:3100/mcp`: it created an organisation and was refused `organisation.archive`, which Sarah can't do. The Connect form itself wasn't clicked through in the browser.
- 2026-11-07 · P1b.08 · [#61](https://github.com/deagil/factory/pull/61) · Settings → Reference (`/settings/reference`) renders `system.describe`: objects with a field table, actions with what they emit and their input and output schemas, queries, and events, each schema in a `<details>`; a Find box (`?q=`) matches names, descriptions and emitted events. Settings → API & MCP (`/settings/api`) explains the routes, `Idempotency-Key`, `?dryRun=true`, the error shape, the MCP endpoint and API keys, with links to the OpenAPI document (`/api/openapi.json` through the proxy), Reference and My agents. Settings is shown to everyone, since both pages show only what the caller can use. Checked: in the browser the admin found `contact.moveToOrganisation` with its input and `contact.moved`; Sam's `system.describe` (what his Reference shows) has only contacts, `contact.update` and `contact.updated`.
- 2026-11-07 · P1b.09 · [#62](https://github.com/deagil/factory/pull/62) · `createDevOutbox` in `packages/auth` keeps the last 20 codes it prints. `createServer({ devOutbox: true })` sends codes through it and serves `GET /dev/session` (active users and the outbox, from `activeUsers` in `packages/db`); without the option the route is a 404. The CRM turns it on only when its `pnpm dev` script sets `FACTORY_DEV=1` and `NODE_ENV` isn't production. The web dev server proxies `/dev`. The dev bar's Session menu (`src/dev/session-menu.tsx`) lists the users as radio items: a choice asks for a code, reads it from the outbox (`codeFor`, newest for that email since the request) and signs in, then clears the query cache and goes home. Sign-in codes lists the outbox; clicking a code copies it. Checked in the browser: Sarah, Sam and Admin were one choice each, and the outbox showed all three codes. A production `vite build` has none of the menu's strings, since the dev bar is mounted only when `import.meta.env.DEV`.
- 2026-11-07 · P1b.10 · [#63](https://github.com/deagil/factory/pull/63) · `lib/api.ts` takes local-development hooks (`setApiDevHooks`) around every call; only the dev bar's API menu sets them, so builds never do. The hooks (`src/dev/api-tools.ts`) add latency, send actions with `?dryRun=true`, fail the next call with any typed error (shaped and statused like the API's own, and marked forced) and record each call with its status, `X-Request-Id`, action id and time. API → Recent calls links each action to Activity. Inspect turns the TanStack devtools (Query and Router panels; `@tanstack/react-query-devtools` added as a dev dependency) on or off, remembered in `localStorage`, and opens the caller's `system.describe` as JSON. The Factory menu shows the change, branch and database, which `vite.config.ts` defines only for the dev server. The forms now show a dry run's output instead of going to the record (`DryRunResult` in `record-form.tsx`), and a `conflict` gets its own message. Top-level dev menus are as wide as their rows. Checked in the browser: with dry runs on, creating Dry Run Ltd showed the result and the list still had three organisations; its action in Activity says dry run with no changes or events, and a real create from the same form afterwards worked. A forced `conflict` on Save showed the conflict message. A production build has none of the menus' strings or the change facts. The menus' state lives in memory, so a full page load turns dry runs off.
- 2026-11-08 · P1b.11 · PR · The demo, from a fresh worktree and database, signing in through the dev bar's Session menu. Sarah created Web Org from the web, then connected an agent from My agents (the Connect form, clicked through this time) and created MCP Org over `localhost:3100/mcp` with its key. The admin made the Billing system integration with Sales in Access → Integrations, made a key on its actor screen, and created Curl Org with `curl` against the API; `organisation.archive` with that key failed. Admin's Activity → Actions shows all three creates, by Sarah Sales, by the agent for Sarah Sales and by Billing system. Sarah's shows only hers and her agent's, and she has no Access section. Sam (support: contacts only) sees no organisations and no actions. Fixed on the way: My agents now lists the new agent while its key is on screen, not only after Done. SYSTEM_DESIGN §4.9 now describes the sections and the dev bar.
