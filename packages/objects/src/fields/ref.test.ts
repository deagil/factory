import { describe, expect, expectTypeOf, it } from "vitest";

import type { ValueOf } from "./field.ts";
import { f } from "./index.ts";
import { acceptsFilter, build, where } from "./test-helpers.ts";

const id = "019a5b3c-7d2e-7f00-8a1b-2c3d4e5f6a7b";
const other = "019a5b3c-7d2e-7f00-8a1b-2c3d4e5f6a7c";

describe("f.ref", () => {
  it("keeps its target, an object or actor", () => {
    expect(f.ref("organisation").target).toBe("organisation");
    const owner = f.ref("actor");
    expect(owner.target).toBe("actor");
    expectTypeOf(owner.target).toEqualTypeOf<"actor">();
  });

  describe("column", () => {
    it("is a uuid column named <field>_id", () => {
      expect(build(f.ref("organisation"), "organisation").shape).toStrictEqual([
        { name: "organisation_id", type: "uuid", notNull: false },
      ]);
    });

    it("is NOT NULL when required", () => {
      expect(
        build(f.ref("organisation", { required: true })).shape[0]?.notNull
      ).toBeTruthy();
    });
  });

  describe("input", () => {
    it("takes a uuid, and null when not required", () => {
      const field = f.ref("organisation");
      expect(field.input.parse(id)).toBe(id);
      expect(field.input.parse(null)).toBeNull();
    });

    it("rejects null when required, and anything that isn't a uuid", () => {
      expect(
        f.ref("organisation", { required: true }).input.safeParse(null).success
      ).toBeFalsy();
      for (const bad of ["", "42", 42, `${id}x`, { id }]) {
        expect(f.ref("organisation").input.safeParse(bad).success).toBeFalsy();
      }
    });

    it("types the value as a string id", () => {
      const field = f.ref("organisation", { required: true });
      expectTypeOf<ValueOf<typeof field>>().toEqualTypeOf<string>();
    });
  });

  it("maps to and from its column, and displays the id", () => {
    const field = f.ref("organisation");
    expect(field.toColumns(id)).toStrictEqual({ "": id });
    expect(field.fromColumns({ "": id })).toBe(id);
    expect(field.display(id)).toBe(id);
    expect(field.display(null)).toBe("");
  });

  describe("filters", () => {
    const field = f.ref("organisation");

    it("supports eq, ne, in and isNull", () => {
      expect(Object.keys(field.filters).toSorted()).toStrictEqual([
        "eq",
        "in",
        "isNull",
        "ne",
      ]);
    });

    it("builds its conditions on the _id column", () => {
      expect(where(field, { eq: id })).toStrictEqual({
        sql: '"t"."value_id" = $1',
        params: [id],
      });
      expect(where(field, { in: [id, other] })).toStrictEqual({
        sql: '"t"."value_id" in ($1, $2)',
        params: [id, other],
      });
      expect(where(field, { isNull: true }).sql).toBe('"t"."value_id" is null');
    });

    it("rejects bad filter values", () => {
      expect(acceptsFilter(field, { eq: "acme" })).toBeFalsy();
      expect(acceptsFilter(field, { gt: id })).toBeFalsy();
    });
  });
});
