import { describe, expect, expectTypeOf, it } from "vitest";
import { z } from "zod";

import { checkChoice, defineChoiceList } from "./choice.ts";
import type { ChoiceOptions, OptionOf } from "./choice.ts";
import type { ValueOf } from "./field.ts";
import { filterSchema, filterWhere } from "./filters.ts";
import { f } from "./index.ts";
import { build, render, where } from "./test-helpers.ts";

const dealStages = defineChoiceList({
  key: "deal-stages",
  columns: { category: z.enum(["open", "won", "lost"]) },
});
const industries = defineChoiceList({ key: "industries" });

const stages: ChoiceOptions = (list) =>
  list === "deal-stages"
    ? [
        { key: "lead", label: "Lead", category: "open" },
        { key: "proposal", label: "Proposal", category: "open" },
        { key: "won", label: "Won", category: "won" },
        { key: "stale", label: "Stale", category: "lost", archived: true },
      ]
    : undefined;

describe(defineChoiceList, () => {
  it("types each option's own columns", () => {
    expectTypeOf<OptionOf<typeof dealStages>["category"]>().toEqualTypeOf<
      "open" | "won" | "lost"
    >();
  });

  it("refuses a column the core reserves", () => {
    expect(() =>
      defineChoiceList({ key: "plans", columns: { color: z.string() } })
    ).toThrow(/"color" is reserved/u);
  });
});

describe("f.choice", () => {
  it("stores the option key in a text column", () => {
    expect(build(f.choice(industries), "industry").shape).toStrictEqual([
      { name: "industry", type: "text", notNull: false },
    ]);
  });

  it("takes only a list's fixed keys, when it has them", () => {
    const status = f.choice(
      defineChoiceList({
        key: "booking-status",
        keys: ["pending", "confirmed"],
      }),
      { required: true }
    );
    expectTypeOf<ValueOf<typeof status>>().toEqualTypeOf<
      "pending" | "confirmed"
    >();
    expect(status.input.parse("pending")).toBe("pending");
    expect(status.input.safeParse("cancelled").success).toBeFalsy();
  });

  it("filters by key, and by a list's own columns", () => {
    const stage = f.choice(dealStages);
    const byColumns = (match: unknown) =>
      render(
        filterWhere(
          stage,
          build(stage).columns,
          filterSchema(stage).parse({ where: match }),
          { choices: stages }
        )
      );
    expect(
      where(f.choice(industries), { in: ["retail", "software"] }).params
    ).toStrictEqual(["retail", "software"]);
    expect(
      filterSchema(f.choice(industries)).safeParse({ where: {} }).success
    ).toBeFalsy();
    expect(byColumns({ category: "lost" }).params).toStrictEqual(["stale"]);
    expect(byColumns({ category: "won" }).params).toStrictEqual(["won"]);
    expect(
      filterSchema(stage).safeParse({ where: { category: "maybe" } }).success
    ).toBeFalsy();
  });
});

describe(checkChoice, () => {
  const stage = f.choice(dealStages);
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
