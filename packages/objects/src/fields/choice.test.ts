import { describe, expect, expectTypeOf, it } from "vitest";

import { checkChoice } from "./choice.ts";
import type { ChoiceField, ChoiceOptions } from "./choice.ts";
import type { ValueOf } from "./field.ts";
import { filterSchema, filterWhere } from "./filters.ts";
import { f } from "./index.ts";
import { build, render, where } from "./test-helpers.ts";

const stages: ChoiceOptions = (list) =>
  list === "deal-stages"
    ? [
        { key: "lead", label: "Lead", category: "open" },
        { key: "proposal", label: "Proposal", category: "open" },
        { key: "won", label: "Won", category: "won" },
        { key: "stale", label: "Stale", category: "lost", archived: true },
      ]
    : undefined;

describe("f.choice", () => {
  it("stores the option key in a text column", () => {
    expect(
      build(f.choice("industries", { control: "custom" }), "industry").shape
    ).toStrictEqual([{ name: "industry", type: "text", notNull: false }]);
  });

  it("takes only the keys code acts on when its control is system", () => {
    const status = f.choice("booking-status", {
      control: "system",
      keys: ["pending", "confirmed"],
      required: true,
    });
    expectTypeOf<ValueOf<typeof status>>().toEqualTypeOf<
      "pending" | "confirmed"
    >();
    expect(status.input.parse("pending")).toBe("pending");
    expect(status.input.safeParse("cancelled").success).toBeFalsy();
  });

  it("filters by key, and a mapped field by category", () => {
    const custom = f.choice("industries", { control: "custom" });
    const stage = f.choice("deal-stages", {
      control: "mapped",
      categories: ["open", "won", "lost"],
    });
    const byCategory = (category: string) =>
      render(
        filterWhere(
          stage,
          build(stage).columns,
          filterSchema(stage).parse({ category }),
          { choices: stages }
        )
      );
    expect(where(custom, { in: ["retail", "software"] }).params).toStrictEqual([
      "retail",
      "software",
    ]);
    expect(
      filterSchema(custom).safeParse({ category: "open" }).success
    ).toBeFalsy();
    expect(byCategory("open").params).toStrictEqual(["lead", "proposal"]);
    expect(byCategory("none").sql).toBe("false");
  });
});

describe(checkChoice, () => {
  const stage = f.choice("deal-stages", {
    control: "mapped",
    categories: ["open", "won", "lost"],
  }) as ChoiceField;
  const check = (value: unknown, current?: unknown) => () =>
    checkChoice("stage", stage, value, { choices: stages, current });

  it("allows a live option, and an archived one only where it already is", () => {
    expect(check("won")).not.toThrow();
    expect(check("stale", "stale")).not.toThrow();
    expect(check("stale", "lead")).toThrow(/archived/u);
    expect(check("nope")).toThrow(
      '"nope" isn\'t an option for stage. Options: lead, proposal, won.'
    );
  });
});
