// Navigation from system.describe: the system's functions in sections.
// Each section lists categories, and each category opens a list. A category
// the caller cannot use is left out, and so is a section with none left
// (decision 0033, amended by 0049 and 0050).
import type { SystemDescription } from "./api.ts";

export type SectionKey =
  | "data"
  | "automation"
  | "activity"
  | "access"
  | "config"
  | "settings";

/** Where a page lives. Each section adds its own routes. */
export type NavLink =
  | { to: "/data/objects" }
  | { to: "/o/$object"; params: { object: string } }
  | { to: "/inbox/approvals" }
  | { to: "/automation/workflows" }
  | { to: "/automation/actions" }
  | { to: "/automation/events" }
  | { to: "/activity/runs" }
  | { to: "/activity/changes" }
  | { to: "/activity/events" }
  | { to: "/access/users" }
  | { to: "/access/agents" }
  | { to: "/access/integrations" }
  | { to: "/access/roles" }
  | { to: "/access/policies" }
  | { to: "/config/drafts" }
  | { to: "/settings/choices" }
  | { to: "/settings/reference" }
  | { to: "/settings/api" };

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

const when = (show: boolean, page: NavPage): NavPage[] => (show ? [page] : []);

const sections: {
  key: SectionKey;
  label: string;
  pages: (description: SystemDescription) => NavPage[];
}[] = [
  {
    key: "data",
    label: "Data",
    // Objects the caller can view, and choice lists they can change.
    pages: (description) => [
      ...when(description.objects.length > 0, {
        key: "data:objects",
        label: "Objects",
        description: "The kinds of record this system keeps.",
        link: { to: "/data/objects" },
      }),
      ...when(has(description, "draft.save"), {
        key: "data:choices",
        label: "Choices",
        description: "The options people pick from, such as deal stages.",
        link: { to: "/settings/choices" },
      }),
    ],
  },
  {
    key: "automation",
    label: "Automation",
    // Definitions the caller may use: workflows they can call, actions they
    // can run, and the events those actions emit.
    pages: (description) => [
      ...when(description.workflows.length > 0, {
        key: "automation:workflows",
        label: "Workflows",
        description:
          "Processes you can run, step by step, each traced as a run.",
        link: { to: "/automation/workflows" },
      }),
      ...when(description.actions.length > 0, {
        key: "automation:actions",
        label: "Actions",
        description: "Operations the system can run, and what each one needs.",
        link: { to: "/automation/actions" },
      }),
      ...when(description.events.length > 0, {
        key: "automation:events",
        label: "Events",
        description: "Things that can happen, which a workflow can listen for.",
        link: { to: "/automation/events" },
      }),
    ],
  },
  {
    key: "activity",
    label: "Activity",
    pages: (description) =>
      [
        {
          query: "auditLog.list",
          page: {
            key: "activity:changes",
            label: "Audit log",
            description: "Every field that changed on every record.",
            link: { to: "/activity/changes" },
          },
        },
        {
          query: "run.list",
          page: {
            key: "activity:runs",
            label: "Workflow runs",
            description:
              "Every call that ran: who made it, for whom, each step and what it did.",
            link: { to: "/activity/runs" },
          },
        },
        {
          query: "eventLog.list",
          page: {
            key: "activity:events",
            label: "Event log",
            description: "What has happened, newest first.",
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
    // only someone who manages access holds. Policies are the approval rules.
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
        {
          query: "draft.files",
          page: {
            key: "access:policies",
            label: "Policies",
            description: "When a change needs sign-off, and from whom.",
            link: { to: "/access/policies" },
          },
        },
      ]
        .filter(({ query }) => has(description, query))
        .map(({ page }) => page as NavPage),
  },
  {
    key: "config",
    label: "Config",
    pages: (description) =>
      when(has(description, "draft.list"), {
        key: "config:drafts",
        label: "Drafts",
        description:
          "Change choices, roles and other config in a draft, then publish it.",
        link: { to: "/config/drafts" },
      }),
  },
  {
    key: "settings",
    label: "Settings",
    // Reference and API & MCP are for everyone: each shows only what the
    // caller can use.
    pages: () => [
      {
        key: "settings:reference",
        label: "Reference",
        description:
          "Every object, action, query and event you can use, with schemas.",
        link: { to: "/settings/reference" },
      },
      {
        key: "settings:api",
        label: "API & MCP",
        description: "Reach this system from code or an AI agent.",
        link: { to: "/settings/api" },
      },
    ],
  },
];

/** Pages in the account menu. Shown only when the caller can use them. */
export const accountPages = (description: SystemDescription): NavPage[] =>
  when(has(description, "approval.list"), {
    key: "account:approvals",
    label: "Approvals",
    description: "Runs and drafts waiting for you to sign them off.",
    link: { to: "/inbox/approvals" },
  });

export const navFrom = (description: SystemDescription): NavSection[] =>
  sections
    .map((section) => ({
      key: section.key,
      label: section.label,
      pages: section.pages(description),
    }))
    .filter((section) => section.pages.length > 0);
