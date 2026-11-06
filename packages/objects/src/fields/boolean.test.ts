import { describe, expect, expectTypeOf, it } from "vitest";

import type { ValueOf } from "./field.ts";
import { f } from "./index.ts";
import { acceptsFilter, build, where } from "./test-helpers.ts";

describe("f.boolean", () => {
  it("is a boolean column, NOT NULL when required", () => {
    expect(build(f.boolean(), "active").shape).toStrictEqual([
      { name: "active", type: "boolean", notNull: false },
    ]);
    expect(build(f.boolean({ required: true })).shape[0]?.notNull).toBeTruthy();
  });

  describe("input", () => {
    it("takes true, false, and null when not required", () => {
      const field = f.boolean();
      expect([field.input.parse(true), field.input.parse(false)]).toStrictEqual(
        [true, false]
      );
      expect(field.input.parse(null)).toBeNull();
    });

    it("rejects null when required, and things that only look boolean", () => {
      expect(
        f.boolean({ required: true }).input.safeParse(null).success
      ).toBeFalsy();
      for (const bad of ["true", 1, 0, ""]) {
        expect(f.boolean().input.safeParse(bad).success).toBeFalsy();
      }
    });

    it("types the value", () => {
      const field = f.boolean({ required: true });
      expectTypeOf<ValueOf<typeof field>>().toEqualTypeOf<boolean>();
    });
  });

  it("maps to and from its column, and displays Yes or No", () => {
    const field = f.boolean();
    expect(field.toColumns(false)).toStrictEqual({ "": false });
    expect([
      field.fromColumns({ "": true }),
      field.fromColumns({ "": false }),
    ]).toStrictEqual([true, false]);
    expect(field.display(true)).toBe("Yes");
    expect(field.display(false)).toBe("No");
    expect(field.display(null)).toBe("");
  });

  describe("filters", () => {
    const field = f.boolean();

    it("supports eq and isNull", () => {
      expect(Object.keys(field.filters).toSorted()).toStrictEqual([
        "eq",
        "isNull",
      ]);
    });

    it("builds its conditions", () => {
      expect(where(field, { eq: false })).toStrictEqual({
        sql: '"t"."value" = $1',
        params: [false],
      });
      expect(where(field, { isNull: false }).sql).toBe(
        '"t"."value" is not null'
      );
    });

    it("rejects bad filter values", () => {
      expect(acceptsFilter(field, { eq: "true" })).toBeFalsy();
      expect(acceptsFilter(field, { ne: true })).toBeFalsy();
    });
  });
});
