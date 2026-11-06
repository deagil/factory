import { describe, expect, expectTypeOf, it } from "vitest";

import type { ValueOf } from "./field.ts";
import { f } from "./index.ts";
import { acceptsFilter, build, where } from "./test-helpers.ts";

describe("f.date", () => {
  describe("column", () => {
    it("is a date column, NOT NULL when required", () => {
      expect(build(f.date(), "expected_close").shape).toStrictEqual([
        { name: "expected_close", type: "date", notNull: false },
      ]);
      expect(build(f.date({ required: true })).shape[0]?.notNull).toBeTruthy();
    });
  });

  describe("input", () => {
    it("takes YYYY-MM-DD, and null when not required", () => {
      const field = f.date();
      expect(field.input.parse("2026-11-06")).toBe("2026-11-06");
      expect(field.input.parse("2024-02-29")).toBe("2024-02-29");
      expect(field.input.parse(null)).toBeNull();
    });

    it("rejects null when required", () => {
      expect(
        f.date({ required: true }).input.safeParse(null).success
      ).toBeFalsy();
    });

    it("rejects days that don't exist, other formats and times", () => {
      const field = f.date();
      const bad = [
        "2025-02-29",
        "2026-13-01",
        "06/11/2026",
        "2026-11-6",
        "2026-11-06T10:00:00Z",
        "",
      ];
      expect(
        bad.filter((value) => field.input.safeParse(value).success)
      ).toStrictEqual([]);
      expect(field.input.safeParse(new Date()).success).toBeFalsy();
    });

    it("types the value as a string", () => {
      const field = f.date({ required: true });
      expectTypeOf<ValueOf<typeof field>>().toEqualTypeOf<string>();
    });
  });

  it("maps to and from its column, and displays the date", () => {
    const field = f.date();
    expect(field.toColumns("2026-11-06")).toStrictEqual({ "": "2026-11-06" });
    expect(field.fromColumns({ "": "2026-11-06" })).toBe("2026-11-06");
    expect(field.display("2026-11-06")).toBe("2026-11-06");
    expect(field.display(null)).toBe("");
  });

  describe("filters", () => {
    const field = f.date();

    it("supports eq, ne, in, gt, gte, lt, lte and isNull", () => {
      expect(Object.keys(field.filters).toSorted()).toStrictEqual([
        "eq",
        "gt",
        "gte",
        "in",
        "isNull",
        "lt",
        "lte",
        "ne",
      ]);
    });

    it("builds date ranges", () => {
      expect(
        where(field, { gte: "2026-01-01", lt: "2027-01-01" })
      ).toStrictEqual({
        sql: '("t"."value" >= $1 and "t"."value" < $2)',
        params: ["2026-01-01", "2027-01-01"],
      });
      expect(where(field, { eq: "2026-11-06" })).toStrictEqual({
        sql: '"t"."value" = $1',
        params: ["2026-11-06"],
      });
    });

    it("rejects bad dates in filters", () => {
      expect(acceptsFilter(field, { gt: "2025-02-29" })).toBeFalsy();
      expect(acceptsFilter(field, { gt: "yesterday" })).toBeFalsy();
      expect(acceptsFilter(field, { contains: "2026" })).toBeFalsy();
    });
  });
});
