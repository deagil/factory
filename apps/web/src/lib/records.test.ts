import { describe, expect, it } from "vitest";

import {
  columnsOf,
  displayValue,
  nextSort,
  titleOf,
  withoutFilter,
} from "./records.ts";
import type { ObjectDescription } from "./records.ts";

const organisation = {
  name: "organisation",
  label: "Organisation",
  list: ["name", "owner"],
  fields: [
    { key: "name", type: "text" },
    { key: "employees", type: "number" },
    { key: "owner", type: "ref", target: "actor" },
  ],
} as unknown as ObjectDescription;

describe("record helpers", () => {
  it("lists the object's list fields in order", () => {
    expect(columnsOf(organisation).map((field) => field.key)).toStrictEqual([
      "name",
      "owner",
    ]);
  });

  it("shows refs by the related record's name", () => {
    const owner = organisation.fields.find((field) => field.key === "owner");
    const shown =
      owner &&
      displayValue(
        owner,
        { owner: "a1" },
        { owner: { a1: { id: "a1", name: "Admin" } } },
        undefined
      );
    expect(shown).toBe("Admin");
  });

  it("flips the sort on the same column", () => {
    expect([
      nextSort(undefined, "name"),
      nextSort("name", "name"),
    ]).toStrictEqual(["name", "-name"]);
  });

  it("removes one filter, and the field once it has none", () => {
    const filter = {
      name: { contains: "a", ne: "b" },
      website: { isNull: true },
    };
    expect(withoutFilter(filter, "website", "isNull")).toStrictEqual({
      name: { contains: "a", ne: "b" },
    });
  });

  it("shows a choice by its label", () => {
    const stage = {
      key: "stage",
      type: "choice",
      options: [
        { key: "lead", label: "Lead", category: "open", archived: false },
        { key: "lost", label: "Lost", category: "lost", archived: true },
      ],
    } as unknown as ObjectDescription["fields"][number];
    expect(displayValue(stage, { stage: "lost" }, {}, undefined)).toBe("Lost");
  });

  it("names a record by its first text field", () => {
    expect(titleOf({ id: "x", name: "Acme" }, organisation)).toBe("Acme");
  });
});
