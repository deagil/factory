# 0033. Web navigation by section, and what the dev bar is for

- **Status:** Accepted
- **Date:** 2026-11-07

## Context

Phase 1's navigation was one link per object in the header. Phase 1 also built things staff and developers need to see that aren't objects: the three logs, people, agents, integrations, roles and keys, and the system's own description. Phases 2 and 4 add more (approvals, workflows, config, the in-app agent). The sidebar is wanted for the agent chat, so navigation can't live there. The local dev bar at the top of the window was starting to collect tools too, and nothing said which tools belong there and which in the app.

## Decision

- **Navigation is in the main pane's header, in three rows.** Sections, with the account menu at the end; a breadcrumb of the current section and the pages above this one; the page's title and primary actions.
- **Sections are a Navigation Menu.** Each opens a panel listing its pages with a line about each, because staff won't know what "Changes" or "Integrations" are until they read it. The panels open after a short hover delay (200 ms), so moving the pointer across the header doesn't flash them. Below `md` the sections are one dropdown.
- **Sections and pages are a typed list in `apps/web/src/lib/nav.ts`,** filtered by `system.describe`: a page shows only when the caller can use what it needs, and a section with no pages is left out. Data's pages are the objects, with their `description`.
- **Screens say which section they're in** through the route's `staticData.section`, and give the pages above them as `PageHeader`'s `trail`. The title is the last step, so the breadcrumb never repeats it.
- **The sidebar is kept for the agent.** It keeps its open, close, resize and side controls and holds a placeholder until the in-app agent (phase 4).
- **The dev bar is for working on the factory, not for using a system.** If a client's admin would need it on a deployed system (logs, keys, roles, the API and MCP details, config), it is in the app behind a permission. If it only makes sense against a local dev server or the factory repo (seeded users, the sign-in outbox, the change and database, simulated latency or errors, design toggles), it is in the dev bar. The dev bar never changes data except through actions or sign-in as the signed-in user, and isn't in production builds. It is a Menubar of commands; app navigation is a Navigation Menu of links, so the two look and behave differently.

## Consequences

- New sections are a list entry and their routes; nothing in the shell changes.
- The breadcrumb follows the route, not the click history: a record opened from Activity still reads `Data › Contacts`.
- The section names a page's place, so object screens no longer need back links.
