import { describe, expect, expectTypeOf, it } from "vitest";

import type { ValueOf } from "./field.ts";
import { f } from "./index.ts";
import { acceptsFilter, build, where } from "./test-helpers.ts";

describe("f.text", () => {
  describe("column", () => {
    it("is a nullable text column by default", () => {
      expect(build(f.text(), "first_name").shape).toStrictEqual([
        { name: "first_name", type: "text", notNull: false },
      ]);
    });

    it("is NOT NULL when required", () => {
      expect(build(f.text({ required: true })).shape).toStrictEqual([
        { name: "value", type: "text", notNull: true },
      ]);
    });
  });

  describe("input", () => {
    it("trims and takes null when not required", () => {
      const field = f.text();
      expect(field.input.parse("  Ada  ")).toBe("Ada");
      expect(field.input.parse(null)).toBeNull();
      expect(field.input.parse("")).toBe("");
    });

    it("rejects null and blank text when required", () => {
      const field = f.text({ required: true });
      expect(field.input.safeParse(null).success).toBeFalsy();
      expect(field.input.safeParse("   ").success).toBeFalsy();
      expect(field.input.parse("Ada")).toBe("Ada");
    });

    it("rejects text over maxLength, after trimming", () => {
      const field = f.text({ maxLength: 3 });
      expect(field.input.parse(" abc ")).toBe("abc");
      expect(field.input.safeParse("abcd").success).toBeFalsy();
    });

    it("rejects other types", () => {
      expect(f.text().input.safeParse(42).success).toBeFalsy();
      expect(f.text().input.safeParse(undefined).success).toBeFalsy();
    });

    it("types the value, with null only when not required", () => {
      const required = f.text({ required: true });
      const optional = f.text();
      expectTypeOf<ValueOf<typeof required>>().toEqualTypeOf<string>();
      expectTypeOf<ValueOf<typeof optional>>().toEqualTypeOf<string | null>();
    });
  });

  describe("output", () => {
    it("reads text stored before a rule was tightened", () => {
      expect(f.text({ maxLength: 1 }).output.parse("long")).toBe("long");
    });
  });

  it("maps to and from its column", () => {
    const field = f.text();
    expect(field.toColumns("Ada")).toStrictEqual({ "": "Ada" });
    expect(field.fromColumns({ "": "Ada" })).toBe("Ada");
    expect(field.fromColumns({ "": null })).toBeNull();
  });

  it("displays the text, and null as empty", () => {
    expect(f.text().display("Ada")).toBe("Ada");
    expect(f.text().display(null)).toBe("");
  });

  describe("filters", () => {
    const field = f.text();

    it("supports eq, ne, in, contains, startsWith and isNull", () => {
      expect(Object.keys(field.filters).toSorted()).toStrictEqual([
        "contains",
        "eq",
        "in",
        "isNull",
        "ne",
        "startsWith",
      ]);
    });

    it("builds equality conditions", () => {
      expect(where(field, { eq: "Ada" })).toStrictEqual({
        sql: '"t"."value" = $1',
        params: ["Ada"],
      });
      expect(where(field, { ne: "Ada" })).toStrictEqual({
        sql: '"t"."value" <> $1',
        params: ["Ada"],
      });
      expect(where(field, { in: ["a", "b"] })).toStrictEqual({
        sql: '"t"."value" in ($1, $2)',
        params: ["a", "b"],
      });
    });

    it("searches ignoring case, matching % and _ literally", () => {
      expect(where(field, { contains: "50%_off" })).toStrictEqual({
        sql: '"t"."value" ilike $1',
        params: [String.raw`%50\%\_off%`],
      });
      expect(where(field, { startsWith: String.raw`a\b` })).toStrictEqual({
        sql: '"t"."value" ilike $1',
        params: [String.raw`a\\b%`],
      });
    });

    it("builds isNull both ways", () => {
      expect(where(field, { isNull: true }).sql).toBe('"t"."value" is null');
      expect(where(field, { isNull: false }).sql).toBe(
        '"t"."value" is not null'
      );
    });

    it("rejects bad filter values", () => {
      expect(acceptsFilter(field, { eq: 1 })).toBeFalsy();
      expect(acceptsFilter(field, { contains: "" })).toBeFalsy();
      expect(acceptsFilter(field, { in: [] })).toBeFalsy();
      expect(acceptsFilter(field, { isNull: "yes" })).toBeFalsy();
      expect(acceptsFilter(field, { gt: "a" })).toBeFalsy();
    });
  });
});
