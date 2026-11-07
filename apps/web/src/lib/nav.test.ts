import { describe, expect, it } from "vitest";

import { navFrom } from "./nav.ts";

const described = (objects: object[], queries: string[] = []) =>
  ({
    objects,
    actions: [],
    queries: queries.map((name) => ({ name })),
    events: [],
  }) as never;

describe(navFrom, () => {
  it("puts the objects in Data, in plural, with their descriptions", () => {
    const nav = navFrom(
      described([
        { name: "contact", label: "Contact", description: "People we know." },
        { name: "company", label: "Company", description: null },
      ])
    );
    expect(nav).toStrictEqual([
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
    expect(nav.map((section) => section.key)).toStrictEqual(["activity"]);
    expect(nav[0]?.pages.map((page) => page.link)).toStrictEqual([
      { to: "/activity/actions" },
      { to: "/activity/events" },
    ]);
  });

  it("leaves out a section with no pages", () => {
    expect(navFrom(described([]))).toStrictEqual([]);
  });
});
