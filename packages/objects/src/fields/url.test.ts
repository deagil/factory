import { describe, expect, expectTypeOf, it } from "vitest";

import type { ValueOf } from "./field.ts";
import { f } from "./index.ts";
import { acceptsFilter, build, where } from "./test-helpers.ts";

describe("f.url", () => {
  describe("column", () => {
    it("is a nullable text column by default", () => {
      expect(build(f.url(), "website").shape).toStrictEqual([
        { name: "website", type: "text", notNull: false },
      ]);
    });

    it("is NOT NULL when required", () => {
      expect(build(f.url({ required: true })).shape).toStrictEqual([
        { name: "value", type: "text", notNull: true },
      ]);
    });
  });

  describe("input", () => {
    it("adds https when the scheme is missing, and keeps http", () => {
      const field = f.url();
      expect(field.input.parse("  acme.example  ")).toBe(
        "https://acme.example"
      );
      expect(field.input.parse("http://acme.example/path")).toBe(
        "http://acme.example/path"
      );
      expect(field.input.parse(null)).toBeNull();
    });

    it("rejects a blank or non-http address", () => {
      const field = f.url();
      expect(field.input.safeParse("").success).toBeFalsy();
      expect(field.input.safeParse("   ").success).toBeFalsy();
      expect(field.input.safeParse("not a url").success).toBeFalsy();
      expect(field.input.safeParse("ftp://acme.example").success).toBeFalsy();
    });

    it("rejects null when required", () => {
      expect(
        f.url({ required: true }).input.safeParse(null).success
      ).toBeFalsy();
    });

    it("rejects an address over maxLength, after adding the scheme", () => {
      const field = f.url({ maxLength: 20 });
      expect(field.input.parse("a.co")).toBe("https://a.co");
      expect(
        field.input.safeParse("acme.example/too-long").success
      ).toBeFalsy();
    });

    it("rejects other types", () => {
      expect(f.url().input.safeParse(42).success).toBeFalsy();
      expect(f.url().input.safeParse(undefined).success).toBeFalsy();
    });

    it("types the value, with null only when not required", () => {
      const required = f.url({ required: true });
      const optional = f.url();
      expectTypeOf<ValueOf<typeof required>>().toEqualTypeOf<string>();
      expectTypeOf<ValueOf<typeof optional>>().toEqualTypeOf<string | null>();
    });
  });

  describe("output", () => {
    it("reads an address stored before the format rule", () => {
      expect(f.url().output.parse("not a url")).toBe("not a url");
    });
  });

  it("maps to and from its column", () => {
    const field = f.url();
    expect(field.toColumns("https://acme.example")).toStrictEqual({
      "": "https://acme.example",
    });
    expect(field.fromColumns({ "": "https://acme.example" })).toBe(
      "https://acme.example"
    );
    expect(field.fromColumns({ "": null })).toBeNull();
  });

  it("displays the address without an http prefix, and null as empty", () => {
    expect(f.url().display("https://acme.example")).toBe("acme.example");
    expect(f.url().display("http://acme.example/path")).toBe(
      "acme.example/path"
    );
    expect(f.url().display(null)).toBe("");
  });

  describe("filters", () => {
    const field = f.url();

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
