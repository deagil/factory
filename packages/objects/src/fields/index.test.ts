import { pgTable } from "drizzle-orm/pg-core";
import { describe, expect, expectTypeOf, it } from "vitest";

import { f } from "./index.ts";

describe("the field types library", () => {
  it("has the field types", () => {
    expect(Object.keys(f).toSorted()).toStrictEqual([
      "boolean",
      "choice",
      "computed",
      "date",
      "email",
      "money",
      "number",
      "ref",
      "text",
      "url",
    ]);
  });

  it("keeps label and description, and defaults required to false", () => {
    const field = f.text({ label: "First name", description: "As used" });
    expect(field.label).toBe("First name");
    expect(field.description).toBe("As used");
    expect(field.required).toBeFalsy();
    expect(f.date({ required: true }).required).toBeTruthy();
  });

  it("gives column builders that type a Drizzle table", () => {
    const value = f.money({ required: true }).columns("value");
    const table = pgTable("deals", {
      title: f.text({ required: true }).columns("title")[""],
      notes: f.text().columns("notes")[""],
      seats: f.number({ integer: true }).columns("seats")[""],
      value: value[""],
      valueCurrency: value.Currency,
      expectedClose: f.date().columns("expected_close")[""],
      won: f.boolean({ required: true }).columns("won")[""],
      organisation: f.ref("organisation").columns("organisation")[""],
    });
    type Row = typeof table.$inferSelect;
    expectTypeOf<Row["title"]>().toEqualTypeOf<string>();
    expectTypeOf<Row["notes"]>().toEqualTypeOf<string | null>();
    expectTypeOf<Row["seats"]>().toEqualTypeOf<number | null>();
    expectTypeOf<Row["value"]>().toEqualTypeOf<number>();
    expectTypeOf<Row["valueCurrency"]>().toEqualTypeOf<string>();
    expectTypeOf<Row["expectedClose"]>().toEqualTypeOf<string | null>();
    expectTypeOf<Row["won"]>().toEqualTypeOf<boolean>();
    expectTypeOf<Row["organisation"]>().toEqualTypeOf<string | null>();
    expect(table.organisation.name).toBe("organisation_id");
  });
});
