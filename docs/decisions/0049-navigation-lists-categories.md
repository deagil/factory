# 0049. Navigation lists categories, then the things in them

- **Status:** Accepted
- **Date:** 2026-11-10
- **Amends:** [0033](0033-web-navigation-and-dev-bar.md), whose Data menu listed each object, and whose Activity menu named the logs Runs, Changes and Events.

## Context

The header is a menu of sections, and each section opens a panel of pages (decision 0033). Data's pages were the objects themselves. That works for two or three objects and stops working as a system grows: the menu becomes an inventory of records, and the other sections mix definitions (what a workflow or an event is) with logs (what has already happened). Staff look for a kind of thing first, then the list of that kind.

## Decision

- **A section's menu lists categories, each linking to a list of that kind.** It does not list the objects, records or runs themselves.
- **Data** holds Objects and Choices. Objects opens the objects the caller can see; each object still has its list, record and create screens. Choices is the choice lists, edited in place, for people who can change config.
- **Automation** holds Workflows, Actions and Events: the workflows the caller can run, the actions a step can call, and the events those actions can emit.
- **Activity** holds the logs: Audit log, Workflow runs and Event log.
- **Access** holds Users, Agents, Integrations, Roles, and Policies (the approval rules) for people who can read config files.
- **Inbox, Config and Settings** stay as they are: Approvals, Drafts, and Reference plus API & MCP. Choice lists leave Settings.
- A category is left out when `system.describe` says the caller cannot use it, and a section with none left is left out.

## Consequences

- An object screen reads Data › Objects › Contacts. A run reads Activity › Workflow runs.
- Choice lists stay at `/settings/choices`; the screen says it is in Data.
- Reference still lists everything the caller can use, with schemas. The menus are how staff find a kind of thing; Reference is the schema view.
