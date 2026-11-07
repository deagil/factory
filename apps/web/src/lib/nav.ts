// Navigation from system.describe: the system's functions in sections, each
// with the pages the caller can use. A section with no pages is left out
// (decision 0033). Phase 1b adds Activity, Access and Settings; phase 2
// adds Inbox, Automation and Config.
import type { SystemDescription } from "./api.ts";

export type SectionKey = "data" | "activity" | "access";

/** Where a page lives. Each section adds its own routes. */
export type NavLink =
  | { to: "/o/$object"; params: { object: string } }
  | { to: "/activity/actions" }
  | { to: "/activity/changes" }
  | { to: "/activity/events" }
  | { to: "/access/users" }
  | { to: "/access/agents" }
  | { to: "/access/integrations" }
  | { to: "/access/roles" };

export interface NavPage {
  key: string;
  label: string;
  description: string;
  link: NavLink;
}

export interface NavSection {
  key: SectionKey;
  label: string;
  pages: NavPage[];
}

/** "contact" → "Contacts"; labels are singular, navigation is plural. */
export const plural = (label: string) =>
  label.endsWith("s") ? label : `${label.replace(/y$/u, "ie")}s`;

/** Whether the caller may run the query or action `name`. */
const has = (description: SystemDescription, name: string) =>
  description.queries.some((query) => query.name === name) ||
  description.actions.some((action) => action.name === name);

const sections: {
  key: SectionKey;
  label: string;
  pages: (description: SystemDescription) => NavPage[];
}[] = [
  {
    key: "data",
    label: "Data",
    // system.describe lists only the objects the caller can view.
    pages: (description) =>
      description.objects.map((object) => ({
        key: `object:${object.name}`,
        label: plural(object.label),
        description:
          object.description ??
          `Every ${object.label.toLowerCase()} in the system.`,
        link: { to: "/o/$object", params: { object: object.name } },
      })),
  },
  {
    key: "activity",
    label: "Activity",
    pages: (description) =>
      [
        {
          query: "actionLog.list",
          page: {
            key: "activity:actions",
            label: "Actions",
            description:
              "Everything that ran: who ran it, for whom, and what it did.",
            link: { to: "/activity/actions" },
          },
        },
        {
          query: "auditLog.list",
          page: {
            key: "activity:changes",
            label: "Changes",
            description: "Every field that changed on every record.",
            link: { to: "/activity/changes" },
          },
        },
        {
          query: "eventLog.list",
          page: {
            key: "activity:events",
            label: "Events",
            description: "What happened, as workflows will hear it.",
            link: { to: "/activity/events" },
          },
        },
      ]
        .filter(({ query }) => has(description, query))
        .map(({ page }) => page as NavPage),
  },
  {
    key: "access",
    label: "Access",
    // Everyone can list their own actors, so each page waits for an action
    // only someone who manages access holds.
    pages: (description) =>
      [
        {
          query: "user.invite",
          page: {
            key: "access:users",
            label: "Users",
            description: "The people who sign in, and their roles.",
            link: { to: "/access/users" },
          },
        },
        {
          query: "actor.setRoles",
          page: {
            key: "access:agents",
            label: "Agents",
            description:
              "AI agents acting for people, such as Claude over MCP.",
            link: { to: "/access/agents" },
          },
        },
        {
          query: "actor.createIntegration",
          page: {
            key: "access:integrations",
            label: "Integrations",
            description: "Other systems with their own keys and roles.",
            link: { to: "/access/integrations" },
          },
        },
        {
          query: "role.list",
          page: {
            key: "access:roles",
            label: "Roles",
            description: "What each role lets its holders see and do.",
            link: { to: "/access/roles" },
          },
        },
      ]
        .filter(({ query }) => has(description, query))
        .map(({ page }) => page as NavPage),
  },
];

export const navFrom = (description: SystemDescription): NavSection[] =>
  sections
    .map((section) => ({
      key: section.key,
      label: section.label,
      pages: section.pages(description),
    }))
    .filter((section) => section.pages.length > 0);
