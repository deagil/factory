import { describe, expect, it } from "vitest";

import {
  avatarSrc,
  columnsOf,
  displayValue,
  filterText,
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

  it("turns a stored filter back into the text its chip edits", () => {
    const [name] = organisation.fields;
    if (name === undefined) {
      throw new Error("organisation has no name field");
    }
    const value = {
      key: "value",
      type: "money",
    } as unknown as ObjectDescription["fields"][number];
    expect(filterText(name, "contains", "acme")).toBe("acme");
    expect(filterText(name, "isNull", true)).toBe("");
    expect(
      filterText(value, "gte", { amount: 1_500_000, currency: "GBP" })
    ).toBe("15000.00");
    expect(filterText(value, "eq", { amount: 1234, currency: "GBP" })).toBe(
      "12.34"
    );
    expect(filterText(name, "where", { category: "open" })).toBe(
      '{"category":"open"}'
    );
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
        {
          key: "lead",
          label: "Lead",
          description: null,
          archived: false,
          columns: { category: "open" },
        },
        {
          key: "lost",
          label: "Lost",
          description: null,
          archived: true,
          columns: { category: "lost" },
        },
      ],
    } as unknown as ObjectDescription["fields"][number];
    expect(displayValue(stage, { stage: "lost" }, {}, undefined)).toBe("Lost");
  });

  it("shows a url without its http prefix", () => {
    const website = {
      key: "website",
      type: "url",
    } as unknown as ObjectDescription["fields"][number];
    expect(
      displayValue(website, { website: "https://acme.example" }, {}, undefined)
    ).toBe("acme.example");
  });

  it("names a record by its first text field", () => {
    expect(titleOf({ id: "x", name: "Acme" }, organisation)).toBe("Acme");
  });

  it("names a record by its display field, and reads an avatar url", () => {
    const person = {
      fields: [
        { key: "firstName", type: "text" },
        { key: "fullName", type: "computed", display: true, avatar: "photo" },
      ],
    } as unknown as ObjectDescription;
    expect(
      titleOf({ id: "x", firstName: "Ada", fullName: "Ada Lovelace" }, person)
    ).toBe("Ada Lovelace");
    expect(avatarSrc({ photo: "https://people.example/ada.png" }, person)).toBe(
      "https://people.example/ada.png"
    );
    expect(avatarSrc({ photo: "/ada.png" }, person)).toBe("/ada.png");
    expect(avatarSrc({ photo: "ada.png" }, person)).toBeNull();
  });
});
