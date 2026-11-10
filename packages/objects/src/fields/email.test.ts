import { describe, expect, expectTypeOf, it } from "vitest";

import type { ValueOf } from "./field.ts";
import { f } from "./index.ts";
import { acceptsFilter, build, where } from "./test-helpers.ts";

describe("f.email", () => {
  describe("column", () => {
    it("is a nullable text column by default", () => {
      expect(build(f.email(), "email").shape).toStrictEqual([
        { name: "email", type: "text", notNull: false },
      ]);
    });

    it("is NOT NULL when required", () => {
      expect(build(f.email({ required: true })).shape).toStrictEqual([
        { name: "value", type: "text", notNull: true },
      ]);
    });
  });

  describe("input", () => {
    it("trims a real address and takes null when not required", () => {
      const field = f.email();
      expect(field.input.parse("  ada@acme.example  ")).toBe(
        "ada@acme.example"
      );
      expect(field.input.parse(null)).toBeNull();
    });

    it("rejects a blank or malformed address", () => {
      const field = f.email();
      expect(field.input.safeParse("").success).toBeFalsy();
      expect(field.input.safeParse("   ").success).toBeFalsy();
      expect(field.input.safeParse("not-an-email").success).toBeFalsy();
      expect(field.input.safeParse("ada@").success).toBeFalsy();
    });

    it("rejects null when required", () => {
      expect(
        f.email({ required: true }).input.safeParse(null).success
      ).toBeFalsy();
    });

    it("rejects an address over maxLength, after trimming", () => {
      const field = f.email({ maxLength: 12 });
      expect(field.input.parse(" a@b.co ")).toBe("a@b.co");
      expect(field.input.safeParse("ada@acme.example").success).toBeFalsy();
    });

    it("rejects other types", () => {
      expect(f.email().input.safeParse(42).success).toBeFalsy();
      expect(f.email().input.safeParse(undefined).success).toBeFalsy();
    });

    it("types the value, with null only when not required", () => {
      const required = f.email({ required: true });
      const optional = f.email();
      expectTypeOf<ValueOf<typeof required>>().toEqualTypeOf<string>();
      expectTypeOf<ValueOf<typeof optional>>().toEqualTypeOf<string | null>();
    });
  });

  describe("output", () => {
    it("reads an address stored before the format rule", () => {
      expect(f.email().output.parse("not-an-email")).toBe("not-an-email");
    });
  });

  it("maps to and from its column", () => {
    const field = f.email();
    expect(field.toColumns("ada@acme.example")).toStrictEqual({
      "": "ada@acme.example",
    });
    expect(field.fromColumns({ "": "ada@acme.example" })).toBe(
      "ada@acme.example"
    );
    expect(field.fromColumns({ "": null })).toBeNull();
  });

  it("displays the address, and null as empty", () => {
    expect(f.email().display("ada@acme.example")).toBe("ada@acme.example");
    expect(f.email().display(null)).toBe("");
  });

  describe("filters", () => {
    const field = f.email();

    it("supports the text operators", () => {
      expect(Object.keys(field.filters).toSorted()).toStrictEqual([
        "contains",
        "eq",
        "in",
        "isNull",
        "ne",
        "startsWith",
      ]);
    });

    it("searches ignoring case", () => {
      expect(where(field, { contains: "acme" })).toStrictEqual({
        sql: '"t"."value" ilike $1',
        params: ["%acme%"],
      });
    });

    it("rejects a filter value that is not text", () => {
      expect(acceptsFilter(field, { eq: 1 })).toBeFalsy();
      expect(acceptsFilter(field, { gt: "a" })).toBeFalsy();
    });
  });
});
