// Navigation from system.describe: the system's functions in sections, each
// with the pages the caller can use. A section with no pages is left out
// (decision 0033). Phase 1b adds Activity, Access and Settings; phase 2
// adds Inbox, Automation and Config.
import type { SystemDescription } from "./api.ts";

export type SectionKey = "data" | "activity";

/** Where a page lives. Each section adds its own routes. */
export type NavLink =
  | { to: "/o/$object"; params: { object: string } }
  | { to: "/activity/actions" }
  | { to: "/activity/changes" }
  | { to: "/activity/events" };

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

/** Whether the caller may run the query `name`. */
const has = (description: SystemDescription, name: string) =>
  description.queries.some((query) => query.name === name);

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
];

export const navFrom = (description: SystemDescription): NavSection[] =>
  sections
    .map((section) => ({
      key: section.key,
      label: section.label,
      pages: section.pages(description),
    }))
    .filter((section) => section.pages.length > 0);
