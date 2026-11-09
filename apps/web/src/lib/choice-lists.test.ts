import { describe, expect, it } from "vitest";

import { listLabel, optionMarks, usesOf } from "./choice-lists.ts";

describe(optionMarks, () => {
  it("marks new and changed options, not unchanged or reordered ones", () => {
    const live = [
      { key: "lead", label: "Lead", category: "open" },
      { key: "won", label: "Won", category: "won" },
    ];
    const current = [
      { key: "won", category: "won", label: "Won" },
      { key: "lead", label: "New lead", category: "open" },
      { key: "negotiation", label: "Negotiation", category: "open" },
    ];
    expect([...optionMarks(current, live)]).toStrictEqual([
      ["lead", "changed"],
      ["negotiation", "new"],
    ]);
  });

  it("treats archived: false as not archived", () => {
    expect(
      optionMarks(
        [{ key: "a", label: "A", archived: false }],
        [{ key: "a", label: "A" }]
      ).size
    ).toBe(0);
  });
});

describe(usesOf, () => {
  it("lists the fields that take their options from the list", () => {
    const description = {
      objects: [
        {
          name: "deal",
          label: "Deal",
          fields: [
            { key: "stage", label: "Stage", list: "deal-stages" },
            { key: "name", label: "Name", list: null },
          ],
        },
      ],
    } as never;
    expect(usesOf(description, "deal-stages")).toStrictEqual([
      {
        object: "deal",
        objectLabel: "Deal",
        field: "stage",
        fieldLabel: "Stage",
      },
    ]);
  });
});

describe(listLabel, () => {
  it("reads a key as words", () => {
    expect(listLabel("deal-stages")).toBe("Deal stages");
  });
});
