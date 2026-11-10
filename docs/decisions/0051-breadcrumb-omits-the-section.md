# 0051. The breadcrumb omits the section

- **Status:** Accepted
- **Date:** 2026-11-10
- **Amends:** [0033](0033-web-navigation-and-dev-bar.md) and [0049](0049-navigation-lists-categories.md), whose breadcrumb started with the section.

## Context

The header marks the current section in the navigation menu (decision 0033). The breadcrumb repeated that name as its first step, so an object screen read Data › Objects › Contact. The section step is not a link and names nothing the menu has not already marked.

## Decision

- **The breadcrumb lists the pages above this one.** It does not name the section. The title stays the last step, so a contact reads Objects › Contacts.
- A page with nothing above it has no breadcrumb. The section is still on the route, and the menu still marks it.

## Consequences

- A record opened from Activity still sits under Objects, because the trail follows the route.
