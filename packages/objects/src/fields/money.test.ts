import { describe, expect, expectTypeOf, it } from "vitest";

import type { ValueOf } from "./field.ts";
import { f } from "./index.ts";
import type { Money } from "./money.ts";
import { formatMoney, minorDigits } from "./money.ts";
import { acceptsFilter, build, where } from "./test-helpers.ts";

const gbp = (amount: number): Money => ({ amount, currency: "GBP" });

describe("f.money", () => {
  describe("columns", () => {
    it("is a bigint amount and a text currency", () => {
      expect(build(f.money(), "value").shape).toStrictEqual([
        { name: "value", type: "bigint", notNull: false },
        { name: "value_currency", type: "text", notNull: false },
      ]);
    });

    it("makes both columns NOT NULL when required", () => {
      expect(
        build(f.money({ required: true })).shape.map((c) => c.notNull)
      ).toStrictEqual([true, true]);
    });
  });

  describe("input", () => {
    it("takes whole minor units with a currency, and null when not required", () => {
      const field = f.money();
      expect(field.input.parse(gbp(1234))).toStrictEqual(gbp(1234));
      expect(field.input.parse({ amount: -5, currency: "JPY" })).toStrictEqual({
        amount: -5,
        currency: "JPY",
      });
      expect(field.input.parse(null)).toBeNull();
    });

    it("rejects null when required", () => {
      expect(
        f.money({ required: true }).input.safeParse(null).success
      ).toBeFalsy();
    });

    it("rejects fractions, unsafe integers and bad shapes", () => {
      const field = f.money();
      expect(field.input.safeParse(gbp(12.5)).success).toBeFalsy();
      expect(field.input.safeParse(gbp(2 ** 53)).success).toBeFalsy();
      expect(field.input.safeParse(1234).success).toBeFalsy();
      expect(field.input.safeParse({ amount: 1 }).success).toBeFalsy();
      expect(
        field.input.safeParse({ ...gbp(1), extra: true }).success
      ).toBeFalsy();
    });

    it("rejects currencies that aren't ISO 4217", () => {
      const field = f.money();
      expect(
        field.input.safeParse({ amount: 1, currency: "gbp" }).success
      ).toBeFalsy();
      expect(
        field.input.safeParse({ amount: 1, currency: "XYZ" }).success
      ).toBeFalsy();
      expect(
        field.input.safeParse({ amount: 1, currency: "POUND" }).success
      ).toBeFalsy();
    });

    it("takes only the field's currency when it has one", () => {
      const field = f.money({ currency: "GBP" });
      expect(field.currency).toBe("GBP");
      expect(field.input.parse(gbp(1))).toStrictEqual(gbp(1));
      expect(
        field.input.safeParse({ amount: 1, currency: "EUR" }).success
      ).toBeFalsy();
    });

    it("refuses a field currency that isn't ISO 4217", () => {
      expect(() => f.money({ currency: "XYZ" })).toThrow(/ISO 4217/u);
    });

    it("types the value", () => {
      const field = f.money();
      expectTypeOf<ValueOf<typeof field>>().toEqualTypeOf<Money | null>();
    });
  });

  it("maps to and from its two columns", () => {
    const field = f.money();
    expect(field.toColumns(gbp(1234))).toStrictEqual({
      "": 1234,
      Currency: "GBP",
    });
    expect(field.toColumns(null)).toStrictEqual({ "": null, Currency: null });
    expect(field.fromColumns({ "": 1234, Currency: "GBP" })).toStrictEqual(
      gbp(1234)
    );
    expect(field.fromColumns({ "": null, Currency: null })).toBeNull();
  });

  describe("display", () => {
    it("shows the code and the amount in major units, without grouping", () => {
      const field = f.money();
      expect(field.display(gbp(123_450))).toBe("GBP 1234.50");
      expect(field.display(gbp(5))).toBe("GBP 0.05");
      expect(field.display(gbp(-1999))).toBe("GBP -19.99");
      expect(field.display({ amount: 1500, currency: "JPY" })).toBe("JPY 1500");
      expect(field.display({ amount: 1234, currency: "BHD" })).toBe(
        "BHD 1.234"
      );
    });

    it("displays null as empty", () => {
      expect(f.money().display(null)).toBe("");
    });

    it("knows each currency's minor digits", () => {
      expect(minorDigits("GBP")).toBe(2);
      expect(minorDigits("JPY")).toBe(0);
      expect(minorDigits("KWD")).toBe(3);
      expect(formatMoney(gbp(0))).toBe("GBP 0.00");
    });
  });

  describe("filters", () => {
    const field = f.money();

    it("supports eq, ne, gt, gte, lt, lte, currency and isNull", () => {
      expect(Object.keys(field.filters).toSorted()).toStrictEqual([
        "currency",
        "eq",
        "gt",
        "gte",
        "isNull",
        "lt",
        "lte",
        "ne",
      ]);
    });

    it("compares amounts only within the same currency", () => {
      const cases = [
        ["eq", "="],
        ["gt", ">"],
        ["gte", ">="],
        ["lt", "<"],
        ["lte", "<="],
      ] as const;
      for (const [op, symbol] of cases) {
        expect(where(field, { [op]: gbp(100) })).toStrictEqual({
          sql: `("t"."value_currency" = $1 and "t"."value" ${symbol} $2)`,
          params: ["GBP", 100],
        });
      }
    });

    it("treats another currency as not equal", () => {
      expect(where(field, { ne: gbp(100) })).toStrictEqual({
        sql: '("t"."value_currency" <> $1 or "t"."value" <> $2)',
        params: ["GBP", 100],
      });
    });

    it("filters by currency alone, and by being empty", () => {
      expect(where(field, { currency: "EUR" })).toStrictEqual({
        sql: '"t"."value_currency" = $1',
        params: ["EUR"],
      });
      expect(where(field, { isNull: true }).sql).toBe('"t"."value" is null');
    });

    it("rejects bad filter values", () => {
      expect(acceptsFilter(field, { gt: 100 })).toBeFalsy();
      expect(
        acceptsFilter(field, { gt: { amount: 1.5, currency: "GBP" } })
      ).toBeFalsy();
      expect(acceptsFilter(field, { currency: "XYZ" })).toBeFalsy();
      expect(acceptsFilter(field, { in: [gbp(1)] })).toBeFalsy();
    });
  });
});
