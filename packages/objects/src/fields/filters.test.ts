import { describe, expect, it } from "vitest";

import { escapeLike, filterSchema, filterWhere } from "./filters.ts";
import { f } from "./index.ts";
import { build } from "./test-helpers.ts";

describe("filters", () => {
  it("escapes LIKE wildcards and backslashes", () => {
    expect(escapeLike("a%b_c")).toBe(String.raw`a\%b\_c`);
    expect(escapeLike(String.raw`back\slash`)).toBe(String.raw`back\\slash`);
    expect(escapeLike("plain")).toBe("plain");
  });

  describe(filterSchema, () => {
    const schema = filterSchema(f.number());

    it("takes one or more of the field's operators", () => {
      expect(schema.parse({ gt: 1 })).toStrictEqual({ gt: 1 });
      expect(schema.parse({ gt: 1, lt: 5 })).toStrictEqual({ gt: 1, lt: 5 });
    });

    it("rejects an empty filter and unknown operators, saying why", () => {
      const empty = schema.safeParse({});
      expect(empty.success).toBeFalsy();
      expect(empty.error?.issues[0]?.message).toMatch(/at least one operator/u);

      const unknown = schema.safeParse({ like: 1 });
      expect(unknown.success).toBeFalsy();
      expect(unknown.error?.issues[0]?.code).toBe("unrecognized_keys");
    });
  });

  describe(filterWhere, () => {
    const field = f.number();
    const { columns } = build(field);

    it("refuses an operator the field doesn't have", () => {
      expect(() => filterWhere(field, columns, { contains: "x" })).toThrow(
        /no "contains" filter/u
      );
    });

    it("refuses a filter with no operators", () => {
      expect(() => filterWhere(field, columns, {})).toThrow(
        /at least one operator/u
      );
    });
  });
});
