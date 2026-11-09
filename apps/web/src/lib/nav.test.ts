import { describe, expect, it } from "vitest";

import { navFrom } from "./nav.ts";

const described = (
  objects: object[],
  queries: string[] = [],
  actions: string[] = []
) =>
  ({
    objects,
    actions: actions.map((name) => ({ name })),
    queries: queries.map((name) => ({ name })),
    events: [],
  }) as never;

const settingsPages = (actions: string[]) =>
  navFrom(described([], [], actions))
    .find((section) => section.key === "settings")
    ?.pages.map((page) => page.key);

describe(navFrom, () => {
  it("puts the objects in Data, in plural, with their descriptions", () => {
    const nav = navFrom(
      described([
        { name: "contact", label: "Contact", description: "People we know." },
        { name: "company", label: "Company", description: null },
      ])
    );
    expect(nav.filter((section) => section.key === "data")).toStrictEqual([
      {
        key: "data",
        label: "Data",
        pages: [
          {
            key: "object:contact",
            label: "Contacts",
            description: "People we know.",
            link: { to: "/o/$object", params: { object: "contact" } },
          },
          {
            key: "object:company",
            label: "Companies",
            description: "Every company in the system.",
            link: { to: "/o/$object", params: { object: "company" } },
          },
        ],
      },
    ]);
  });

  it("puts the logs the caller can read in Activity", () => {
    const nav = navFrom(described([], ["actionLog.list", "eventLog.list"]));
    expect(nav.map((section) => section.key)).toStrictEqual([
      "activity",
      "settings",
    ]);
    expect(nav[0]?.pages.map((page) => page.link)).toStrictEqual([
      { to: "/activity/actions" },
      { to: "/activity/events" },
    ]);
  });

  it("shows Access pages only to those who manage access", () => {
    const own = navFrom(described([], ["actor.list", "actor.get"]));
    const admin = navFrom(
      described([], ["role.list"], ["user.invite", "actor.setRoles"])
    );
    expect(own.map((section) => section.key)).toStrictEqual(["settings"]);
    expect(admin[0]?.pages.map((page) => page.label)).toStrictEqual([
      "Users",
      "Agents",
      "Roles",
    ]);
  });

  it("puts approvals in Inbox and drafts in Config", () => {
    const nav = navFrom(described([], ["approval.list", "draft.list"]));
    expect(
      nav.map((section) => [section.key, section.pages[0]?.link])
    ).toStrictEqual([
      ["inbox", { to: "/inbox/approvals" }],
      ["config", { to: "/config/drafts" }],
      ["settings", { to: "/settings/reference" }],
    ]);
  });

  it("leaves out a section with no pages, and always has Settings", () => {
    expect(navFrom(described([])).map((section) => section.key)).toStrictEqual([
      "settings",
    ]);
  });

  it("shows Choice lists in Settings only to those who can change config", () => {
    expect(settingsPages([])).toStrictEqual([
      "settings:reference",
      "settings:api",
    ]);
    expect(settingsPages(["draft.save"])).toStrictEqual([
      "settings:choices",
      "settings:reference",
      "settings:api",
    ]);
  });
});
