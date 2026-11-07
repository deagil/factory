// Navigation from system.describe: one entry per object the caller can read.
import type { SystemDescription } from "./api.ts";

export interface NavItem {
  object: string;
  label: string;
}

/** "contact" → "Contacts"; labels are singular, navigation is plural. */
const plural = (label: string) =>
  label.endsWith("s") ? label : `${label.replace(/y$/u, "ie")}s`;

export const navFrom = (description: SystemDescription): NavItem[] =>
  description.objects.map((object) => ({
    object: object.name,
    label: plural(object.label),
  }));
