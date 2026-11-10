import { describe, expect, it } from "vitest";

import { accountPages, navFrom } from "./nav.ts";

const described = (
  objects: object[],
  queries: string[] = [],
  actions: string[] = [],
  extra: { events?: object[]; workflows?: object[] } = {}
) =>
  ({
    objects,
    actions: actions.map((name) => ({ name })),
    queries: queries.map((name) => ({ name })),
    events: extra.events ?? [],
    workflows: extra.workflows ?? [],
  }) as never;

const pages = (key: string, description: ReturnType<typeof described>) =>
  navFrom(description)
    .find((section) => section.key === key)
    ?.pages.map((page) => page.key);

describe(navFrom, () => {
  it("puts Objects in Data when the caller can see any", () => {
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
            key: "data:objects",
            label: "Objects",
            description: "The kinds of record this system keeps.",
            link: { to: "/data/objects" },
          },
        ],
      },
    ]);
  });

  it("puts Choices in Data for people who can change config", () => {
    expect(pages("data", described([]))).toBeUndefined();
    expect(pages("data", described([], [], ["draft.save"]))).toStrictEqual([
      "data:choices",
    ]);
    expect(pages("settings", described([], [], ["draft.save"]))).toStrictEqual([
      "settings:reference",
      "settings:api",
    ]);
  });

  it("shows Workflows to people who can read them or only run them", () => {
    expect(
      pages("automation", described([], [], [], { workflows: [{}] }))
    ).toStrictEqual(["automation:workflows"]);
    expect(
      pages(
        "automation",
        described([], [], [], { workflows: [{ key: "workflow_list" }] })
      )
    ).toStrictEqual(["automation:workflows"]);
    expect(pages("automation", described([]))).toBeUndefined();
  });

  it("groups workflows, actions and events under Automation", () => {
    expect(
      pages(
        "automation",
        described([], [], ["contact_create"], {
          events: [{ type: "contact.created" }],
          workflows: [{}],
        })
      )
    ).toStrictEqual([
      "automation:workflows",
      "automation:actions",
      "automation:events",
    ]);
  });

  it("puts the logs the caller can read in Activity", () => {
    const nav = navFrom(described([], ["run.list", "eventLog.list"]));
    expect(nav.map((section) => section.key)).toStrictEqual([
      "activity",
      "settings",
    ]);
    expect(nav[0]?.pages.map((page) => page.label)).toStrictEqual([
      "Workflow runs",
      "Event log",
    ]);
    expect(nav[0]?.pages.map((page) => page.link)).toStrictEqual([
      { to: "/activity/runs" },
      { to: "/activity/events" },
    ]);
  });

  it("shows Access pages only to those who manage access", () => {
    const own = navFrom(described([], ["actor.list", "actor.get"]));
    const admin = navFrom(
      described(
        [],
        ["role.list", "draft.files"],
        ["user.invite", "actor.setRoles"]
      )
    );
    expect(own.map((section) => section.key)).toStrictEqual(["settings"]);
    expect(
      admin
        .find((section) => section.key === "access")
        ?.pages.map((page) => page.label)
    ).toStrictEqual(["Users", "Agents", "Roles", "Policies"]);
  });

  it("puts approvals in the account menu and drafts in Config", () => {
    const description = described([], ["approval.list", "draft.list"]);
    expect(
      navFrom(description).map((section) => [
        section.key,
        section.pages[0]?.link,
      ])
    ).toStrictEqual([
      ["config", { to: "/config/drafts" }],
      ["settings", { to: "/settings/reference" }],
    ]);
    expect(accountPages(description)).toStrictEqual([
      {
        key: "account:approvals",
        label: "Approvals",
        description: "Runs and drafts waiting for you to sign them off.",
        link: { to: "/inbox/approvals" },
      },
    ]);
    expect(accountPages(described([]))).toStrictEqual([]);
  });

  it("leaves out a section with no pages, and always has Settings", () => {
    expect(navFrom(described([])).map((section) => section.key)).toStrictEqual([
      "settings",
    ]);
  });
});
