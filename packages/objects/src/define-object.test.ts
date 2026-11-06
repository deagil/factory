import { getTableConfig } from "drizzle-orm/pg-core";
import { describe, expect, expectTypeOf, it } from "vitest";
import type { z } from "zod";

import { defineObject } from "./define-object.ts";
import { f } from "./fields/index.ts";
import type { Money } from "./fields/money.ts";
import { getObject, listObjects } from "./registry.ts";

const id = "019a5b3c-7d2e-7f00-8a1b-2c3d4e5f6a7b";

const company = defineObject({
  name: "company",
  fields: {
    name: f.text({ required: true }),
    website: f.text({ label: "Web site" }),
  },
  customFields: true,
});

const deal = defineObject({
  name: "deal",
  label: "Opportunity",
  fields: {
    title: f.text({ required: true, maxLength: 100 }),
    company: f.ref("company", { required: true }),
    value: f.money(),
    stage: f.text({ required: true }),
    expectedClose: f.date(),
    owner: f.ref("actor"),
    won: f.boolean(),
  },
  list: ["title", "value"],
  actions: { update: { readOnly: ["stage"] }, archive: "deal.close" },
});

const columnsOf = (table: Parameters<typeof getTableConfig>[0]) =>
  getTableConfig(table).columns.map((c) => c.name);

describe(defineObject, () => {
  describe("the table", () => {
    it("is named after the object, in the plural", () => {
      expect(deal.tableName).toBe("deals");
      expect(getTableConfig(company.table).name).toBe("companies");
    });

    it("has the housekeeping columns, then the fields' columns", () => {
      expect(columnsOf(deal.table)).toStrictEqual([
        "id",
        "created_at",
        "updated_at",
        "created_by",
        "updated_by",
        "archived_at",
        "version",
        "title",
        "company_id",
        "value",
        "value_currency",
        "stage",
        "expected_close",
        "owner_id",
        "won",
      ]);
    });

    it("has custom_fields only when asked", () => {
      expect(columnsOf(company.table)).toContain("custom_fields");
      expect(columnsOf(deal.table)).not.toContain("custom_fields");
    });

    it("points refs and the actor columns at their tables", () => {
      const targets = getTableConfig(deal.table).foreignKeys.map((fk) => {
        const ref = fk.reference();
        return `${ref.columns[0]?.name} → ${getTableConfig(ref.foreignTable).name}`;
      });
      expect(targets.toSorted()).toStrictEqual([
        "company_id → companies",
        "created_by → actors",
        "owner_id → actors",
        "updated_by → actors",
      ]);
    });

    it("types its columns from the fields", () => {
      type Row = typeof deal.table.$inferSelect;
      expectTypeOf<Row["title"]>().toEqualTypeOf<string>();
      expectTypeOf<Row["company"]>().toEqualTypeOf<string>();
      expectTypeOf<Row["valueCurrency"]>().toEqualTypeOf<string | null>();
      expectTypeOf<Row["archivedAt"]>().toEqualTypeOf<Date | null>();
      expectTypeOf<typeof company.table.$inferSelect>().toHaveProperty(
        "customFields"
      );
    });
  });

  describe("the create schema", () => {
    const { create } = deal.schemas;
    const minimal = { title: "Renewal", company: id, stage: "lead" };

    it("takes the required fields, and leaves out or nulls the rest", () => {
      expect(create.parse(minimal)).toStrictEqual(minimal);
      expect(create.parse({ ...minimal, won: null })).toStrictEqual({
        ...minimal,
        won: null,
      });
    });

    it("refuses a missing required field", () => {
      const { title: _title, ...noTitle } = minimal;
      expect(create.safeParse(noTitle).success).toBeFalsy();
    });

    it("refuses bad values, unknown fields and housekeeping columns", () => {
      expect(
        create.safeParse({ ...minimal, title: "x".repeat(101) }).success
      ).toBeFalsy();
      expect(
        create.safeParse({ ...minimal, colour: "red" }).success
      ).toBeFalsy();
      expect(create.safeParse({ ...minimal, id }).success).toBeFalsy();
      expect(create.safeParse({ ...minimal, version: 2 }).success).toBeFalsy();
    });

    it("types its input", () => {
      type Input = z.output<typeof create>;
      expectTypeOf<Input["title"]>().toEqualTypeOf<string>();
      expectTypeOf<Input["value"]>().toEqualTypeOf<Money | null | undefined>();
    });
  });

  describe("the update schema", () => {
    const { update } = deal.schemas;

    it("takes any editable fields, or none", () => {
      expect(update.parse({})).toStrictEqual({});
      expect(update.parse({ title: "New", won: true })).toStrictEqual({
        title: "New",
        won: true,
      });
    });

    it("refuses read-only fields and bad values", () => {
      expect(update.safeParse({ stage: "won" }).success).toBeFalsy();
      expect(update.safeParse({ title: "" }).success).toBeFalsy();
      expect(update.safeParse({ title: null }).success).toBeFalsy();
    });

    it("types out the read-only fields", () => {
      type Input = z.output<typeof update>;
      expectTypeOf<Input>().not.toHaveProperty("stage");
      expectTypeOf<Input>().toHaveProperty("title");
    });
  });

  describe("records", () => {
    const row = {
      id,
      createdAt: new Date("2026-11-06T10:00:00Z"),
      updatedAt: new Date("2026-11-06T11:00:00Z"),
      createdBy: id,
      updatedBy: id,
      archivedAt: null,
      version: 2,
      title: "Renewal",
      company: id,
      value: 1250,
      valueCurrency: "EUR",
      stage: "lead",
      expectedClose: null,
      owner: null,
      won: null,
    };

    it("come from rows, with ISO timestamps and field values", () => {
      expect(deal.fromRow(row)).toMatchObject({
        createdAt: "2026-11-06T10:00:00.000Z",
        archivedAt: null,
        value: { amount: 1250, currency: "EUR" },
        version: 2,
      });
    });

    it("match the record schema", () => {
      const record = deal.fromRow(row);
      expect(deal.schemas.record.parse(record)).toStrictEqual(record);
      expect(
        deal.schemas.record.safeParse({ ...record, id: "x" }).success
      ).toBeFalsy();
    });

    it("carry custom fields when the object has them", () => {
      const record = company.fromRow({
        ...row,
        name: "Acme",
        website: null,
        customFields: { tier: 1 },
      });
      expect(record.customFields).toStrictEqual({ tier: 1 });
      expect(company.schemas.record.parse(record)).toStrictEqual(record);
    });

    it("map field values to columns", () => {
      expect(
        deal.toRow({
          title: "Renewal",
          value: { amount: 5, currency: "GBP" },
          won: undefined,
        })
      ).toStrictEqual({ title: "Renewal", value: 5, valueCurrency: "GBP" });
      expect(() => deal.toRow({ colour: "red" } as never)).toThrow(
        /no field "colour"/u
      );
    });

    it("give each field's columns by suffix", () => {
      const value = deal.columnsOf("value");
      expect(Object.keys(value)).toStrictEqual(["", "Currency"]);
      expect(value.Currency?.name).toBe("value_currency");
    });
  });

  describe("options", () => {
    it("derive labels from names unless given", () => {
      expect(company.label).toBe("Company");
      expect(deal.label).toBe("Opportunity");
      expect(deal.fieldLabels.expectedClose).toBe("Expected close");
      expect(company.fieldLabels.website).toBe("Web site");
    });

    it("list the first five fields unless given a list", () => {
      expect(deal.list).toStrictEqual(["title", "value"]);
      expect(company.list).toStrictEqual(["name", "website"]);
    });

    it("say which generated actions exist and who owns the rest", () => {
      expect(deal.actions).toStrictEqual({
        create: { generated: true, ownedBy: undefined },
        update: { generated: true, ownedBy: undefined, readOnly: ["stage"] },
        archive: { generated: false, ownedBy: "deal.close" },
      });
      const fixed = defineObject({
        name: "fixedRate",
        fields: { rate: f.number() },
        actions: { create: false, update: false },
      });
      expect([
        fixed.actions.create.generated,
        fixed.actions.update.generated,
      ]).toStrictEqual([false, false]);
    });
  });

  describe("the registry", () => {
    it("finds objects by name", () => {
      expect(getObject("deal")).toBe(deal);
      expect(getObject("nothing")).toBeUndefined();
      expect(listObjects().map((o) => o.name)).toContain("company");
    });
  });

  describe("mistakes it refuses", () => {
    const text = f.text();

    it("refuses bad and taken names", () => {
      expect(() => defineObject({ name: "Deal", fields: { a: text } })).toThrow(
        /camelCase/u
      );
      expect(() => defineObject({ name: "deal", fields: { a: text } })).toThrow(
        /already defined/u
      );
      expect(() =>
        defineObject({ name: "other", table: "deals", fields: { a: text } })
      ).toThrow(/already used by "deal"/u);
      expect(() => defineObject({ name: "user", fields: { a: text } })).toThrow(
        /core table/u
      );
    });

    it("refuses an object with no fields", () => {
      expect(() => defineObject({ name: "empty", fields: {} })).toThrow(
        /at least one field/u
      );
    });

    it("refuses field keys that clash", () => {
      expect(() =>
        defineObject({ name: "a1", fields: { version: text } })
      ).toThrow(/housekeeping column/u);
      expect(() =>
        defineObject({ name: "a2", fields: { First: text } })
      ).toThrow(/camelCase/u);
      expect(() =>
        defineObject({
          name: "a3",
          fields: { price: f.money(), priceCurrency: text },
        })
      ).toThrow(/"priceCurrency", which is used by the field "price"/u);
      expect(() =>
        defineObject({
          name: "a4",
          fields: { owner: f.ref("actor"), ownerId: text },
        })
      ).toThrow(/both need the column "owner_id"/u);
    });

    it("refuses list, readOnly and action names that don't fit", () => {
      expect(() =>
        defineObject({ name: "b1", fields: { a: text }, list: ["b" as "a"] })
      ).toThrow(/list names "b"/u);
      expect(() =>
        defineObject({
          name: "b2",
          fields: { a: text },
          actions: { update: { readOnly: ["b" as "a"] } },
        })
      ).toThrow(/readOnly names "b"/u);
      expect(() =>
        defineObject({
          name: "b3",
          fields: { a: text },
          actions: { create: "place" },
        })
      ).toThrow(/an action name such as "b3.place"/u);
    });

    it("refuses a ref to an object that isn't defined, when the table is built", () => {
      const orphan = defineObject({
        name: "orphan",
        fields: { parent: f.ref("nowhere") },
      });
      const { foreignKeys } = getTableConfig(orphan.table);
      expect(() => foreignKeys.map((key) => key.reference())).toThrow(
        /"nowhere", which isn't a defined object/u
      );
    });
  });
});
