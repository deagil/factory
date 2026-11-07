// Navigation from system.describe: the system's functions in sections, each
// with the pages the caller can use. A section with no pages is left out
// (decision 0033). Phase 1b adds Activity, Access and Settings; phase 2
// adds Inbox, Automation and Config.
import type { SystemDescription } from "./api.ts";

export type SectionKey = "data";

/** Where a page lives. Each section adds its own routes. */
export interface NavLink {
  to: "/o/$object";
  params: { object: string };
}

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
];

export const navFrom = (description: SystemDescription): NavSection[] =>
  sections
    .map((section) => ({
      key: section.key,
      label: section.label,
      pages: section.pages(description),
    }))
    .filter((section) => section.pages.length > 0);
