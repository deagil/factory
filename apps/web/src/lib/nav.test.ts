import { describe, expect, it } from "vitest";

import { navFrom } from "./nav.ts";

describe(navFrom, () => {
  it("lists exactly the objects in the description, in plural", () => {
    const nav = navFrom({
      objects: [
        { name: "contact", label: "Contact" },
        { name: "company", label: "Company" },
      ],
      actions: [],
      queries: [],
      events: [],
    } as never);
    expect(nav).toStrictEqual([
      { object: "contact", label: "Contacts" },
      { object: "company", label: "Companies" },
    ]);
  });
});
