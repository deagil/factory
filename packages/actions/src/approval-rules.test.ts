import { describe, expect, it } from "vitest";

import {
  approvalRuleSchema,
  conditionHolds,
  rulesForAction,
  rulesForFiles,
  signOffsFor,
} from "./approval-rules.ts";
import type { ApprovalRule, Condition } from "./approval-rules.ts";
import { grantedBy } from "./permissions.ts";

const rules: ApprovalRule[] = [
  {
    key: "big-discounts",
    label: "Big discounts",
    action: "deal.discount",
    when: [
      { field: "percent", operator: "gt", value: 20 },
      { field: "customer.tier", operator: "in", value: ["gold", "silver"] },
    ],
    approver: "manager",
  },
  {
    key: "roles",
    label: "Roles",
    config: ["roles"],
    approver: "admin",
  },
];

describe("approval rules", () => {
  it.each<[Condition, unknown, boolean]>([
    [{ field: "a", operator: "eq", value: null }, {}, true],
    [{ field: "a.b", operator: "ne", value: "x" }, { a: { b: "y" } }, true],
    [{ field: "a", operator: "notIn", value: [1, 2] }, { a: 2 }, false],
    [{ field: "a", operator: "gte", value: 5 }, { a: 5 }, true],
    [{ field: "a", operator: "lt", value: 5 }, { a: "4" }, false],
  ])("tests %o against %o", (condition, input, holds) => {
    expect(conditionHolds(condition, input)).toBe(holds);
  });

  it("matches an action's rules only when every condition holds", () => {
    const gold = { percent: 25, customer: { tier: "gold" } };
    expect({
      matched: rulesForAction(rules, "deal.discount", gold).map((r) => r.key),
      small: rulesForAction(rules, "deal.discount", { ...gold, percent: 5 }),
      files: rulesForFiles(rules, ["config/roles/sales.yaml"]).map(
        (r) => r.key
      ),
      choices: rulesForFiles(rules, ["config/choices/stages.yaml"]),
    }).toStrictEqual({
      matched: ["big-discounts"],
      small: [],
      files: ["roles"],
      choices: [],
    });
  });

  it("doesn't ask staff who hold the approver role, but always asks agents", () => {
    const manager = grantedBy([
      { key: "manager", label: "Manager", permissions: [] },
    ]);
    const actor = { id: "a", name: "Mo", userId: "u" };
    expect({
      staff: signOffsFor(rules, { ...actor, kind: "staff" }, manager),
      agent: signOffsFor(rules, { ...actor, kind: "agent" }, manager),
    }).toStrictEqual({
      staff: [{ ruleKey: "roles", approverRole: "admin" }],
      agent: [
        { ruleKey: "big-discounts", approverRole: "manager" },
        { ruleKey: "roles", approverRole: "admin" },
      ],
    });
  });

  it("refuses a list for eq, and a rule with neither an action nor config", () => {
    expect({
      list: approvalRuleSchema.safeParse({
        key: "x",
        label: "X",
        action: "deal.update",
        when: [{ field: "a", operator: "eq", value: [1] }],
        approver: "admin",
      }).success,
      neither: approvalRuleSchema.safeParse({
        key: "x",
        label: "X",
        approver: "admin",
      }).success,
    }).toStrictEqual({ list: false, neither: false });
  });
});
