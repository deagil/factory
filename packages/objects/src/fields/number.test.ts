import { describe, expect, expectTypeOf, it } from "vitest";

import type { ValueOf } from "./field.ts";
import { f } from "./index.ts";
import { acceptsFilter, build, where } from "./test-helpers.ts";

describe("f.number", () => {
  describe("column", () => {
    it("is double precision by default", () => {
      expect(build(f.number(), "score").shape).toStrictEqual([
        { name: "score", type: "double precision", notNull: false },
      ]);
    });

    it("is integer when integer, and NOT NULL when required", () => {
      expect(
        build(f.number({ integer: true, required: true }), "seats").shape
      ).toStrictEqual([{ name: "seats", type: "integer", notNull: true }]);
    });
  });

  describe("input", () => {
    it("takes numbers, and null when not required", () => {
      const field = f.number();
      expect(field.input.parse(1.5)).toBe(1.5);
      expect(field.input.parse(-3)).toBe(-3);
      expect(field.input.parse(null)).toBeNull();
    });

    it("rejects null when required", () => {
      expect(
        f.number({ required: true }).input.safeParse(null).success
      ).toBeFalsy();
    });

    it("rejects strings, NaN and infinity", () => {
      const field = f.number();
      expect(field.input.safeParse("1").success).toBeFalsy();
      expect(field.input.safeParse(Number.NaN).success).toBeFalsy();
      expect(
        field.input.safeParse(Number.POSITIVE_INFINITY).success
      ).toBeFalsy();
    });

    it("keeps to min and max", () => {
      const field = f.number({ min: 0, max: 100 });
      expect(field.input.parse(0)).toBe(0);
      expect(field.input.parse(100)).toBe(100);
      expect(field.input.safeParse(-0.1).success).toBeFalsy();
      expect(field.input.safeParse(100.1).success).toBeFalsy();
    });

    it("takes only whole numbers that fit an integer column when integer", () => {
      const field = f.number({ integer: true });
      expect(field.input.parse(2_147_483_647)).toBe(2_147_483_647);
      expect(field.input.safeParse(1.5).success).toBeFalsy();
      expect(field.input.safeParse(2_147_483_648).success).toBeFalsy();
      expect(field.input.safeParse(-2_147_483_649).success).toBeFalsy();
    });

    it("types the value", () => {
      const field = f.number({ required: true });
      expectTypeOf<ValueOf<typeof field>>().toEqualTypeOf<number>();
    });
  });

  it("maps to and from its column", () => {
    const field = f.number();
    expect(field.toColumns(4)).toStrictEqual({ "": 4 });
    expect(field.fromColumns({ "": 4 })).toBe(4);
    expect(field.fromColumns({ "": null })).toBeNull();
  });

  it("displays the number plainly, and null as empty", () => {
    const field = f.number();
    expect(field.display(1_234_567.5)).toBe("1234567.5");
    expect(field.display(0)).toBe("0");
    expect(field.display(null)).toBe("");
  });

  describe("filters", () => {
    const field = f.number();

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

    it("builds each comparison", () => {
      const cases = [
        ["eq", "="],
        ["ne", "<>"],
        ["gt", ">"],
        ["gte", ">="],
        ["lt", "<"],
        ["lte", "<="],
      ] as const;
      for (const [op, symbol] of cases) {
        expect(where(field, { [op]: 5 })).toStrictEqual({
          sql: `"t"."value" ${symbol} $1`,
          params: [5],
        });
      }
      expect(where(field, { in: [1, 2] })).toStrictEqual({
        sql: '"t"."value" in ($1, $2)',
        params: [1, 2],
      });
      expect(where(field, { isNull: true }).sql).toBe('"t"."value" is null');
    });

    it("joins operators with and, for ranges", () => {
      expect(where(field, { gte: 10, lt: 20 })).toStrictEqual({
        sql: '("t"."value" >= $1 and "t"."value" < $2)',
        params: [10, 20],
      });
    });

    it("rejects bad filter values", () => {
      expect(acceptsFilter(field, { eq: "5" })).toBeFalsy();
      expect(acceptsFilter(field, { contains: "5" })).toBeFalsy();
      expect(
        acceptsFilter(field, { in: Array.from({ length: 101 }, () => 1) })
      ).toBeFalsy();
    });

    it("keeps an integer field's filters to int32", () => {
      const whole = f.number({ integer: true });
      expect(acceptsFilter(whole, { eq: 2 })).toBeTruthy();
      expect(acceptsFilter(whole, { eq: 1.5 })).toBeFalsy();
      expect(acceptsFilter(whole, { gt: 2_147_483_648 })).toBeFalsy();
      expect(acceptsFilter(whole, { in: [-2_147_483_649] })).toBeFalsy();
      expect(acceptsFilter(field, { eq: 1.5 })).toBeTruthy();
    });
  });
});
