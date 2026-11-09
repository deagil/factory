import { describe, expect, it } from "vitest";

import {
  approvalRuleSchema,
  conditionHolds,
  describeSignOffs,
  rulesForAction,
  rulesForFiles,
  signOffsFor,
  unmetSignOff,
} from "./approval-rules.ts";
import type { ApprovalRule, Condition } from "./approval-rules.ts";
import { grantedBy } from "./permissions.ts";

const gbp = (pounds: number) => ({ amount: pounds * 100, currency: "GBP" });
const over = (pounds: number): Condition[] => [
  { field: "record.value.currency", operator: "eq", value: "GBP" },
  { field: "record.value.amount", operator: "gt", value: pounds * 100 },
];

const rules: ApprovalRule[] = [
  {
    key: "large-manager",
    label: "Large, manager",
    action: "payment.release",
    record: { object: "payment", id: "input.id" },
    when: over(1000),
    approver: "manager",
    exempt: ["manager", "senior"],
  },
  {
    key: "large-senior",
    label: "Large, senior",
    action: "payment.release",
    record: { object: "payment", id: "input.id" },
    when: over(1000),
    approver: "senior",
  },
  {
    key: "credits",
    label: "Credits by juniors",
    action: "credit.issue",
    requester: ["junior"],
    approvals: 2,
    approver: "manager",
  },
  { key: "roles", label: "Roles", config: ["roles"], approver: "admin" },
];

const holding = (...keys: string[]) =>
  grantedBy(keys.map((key) => ({ key, label: key, permissions: [] })));
const staff = { id: "a", name: "Jo", userId: "u", kind: "staff" as const };

/** Whether `rule` asks a staff member or agent holding `roles`. */
const asked = (
  rule: ApprovalRule | undefined,
  kind: "staff" | "agent",
  ...roles: string[]
) =>
  signOffsFor(rule ? [rule] : [], { ...staff, kind }, holding(...roles))
    .length > 0;

describe("approval rules", () => {
  it.each<[Condition, unknown, boolean]>([
    [{ field: "input.a", operator: "eq", value: null }, {}, true],
    [
      { field: "input.a.b", operator: "ne", value: "x" },
      { a: { b: "y" } },
      true,
    ],
    [{ field: "input.a", operator: "notIn", value: [1, 2] }, { a: 2 }, false],
    [{ field: "input.a", operator: "gte", value: 5 }, { a: 5 }, true],
    [{ field: "input.a", operator: "lt", value: 5 }, { a: "4" }, false],
  ])("tests %o against %o", (condition, input, holds) => {
    expect(conditionHolds(condition, { input })).toBe(holds);
  });

  it("tests the record a rule names, reading each record once", async () => {
    const reads: string[] = [];
    const payments: Record<string, unknown> = {
      small: { value: gbp(50) },
      large: { value: gbp(5000) },
    };
    const load = (object: string, id: string) => {
      reads.push(`${object}:${id}`);
      return Promise.resolve(payments[id] ?? null);
    };
    const keys = async (id: string) => {
      const matched = await rulesForAction(
        rules,
        "payment.release",
        { id },
        load
      );
      return matched.map((rule) => rule.key);
    };
    expect({
      large: await keys("large"),
      small: await keys("small"),
      missing: await keys("missing"),
      reads,
    }).toStrictEqual({
      large: ["large-manager", "large-senior"],
      small: [],
      missing: [],
      reads: ["payment:large", "payment:small", "payment:missing"],
    });
  });

  it("asks by requester and exempt roles, and always asks agents", () => {
    const [manager, senior, credits] = rules;
    expect({
      // The manager tier skips managers and seniors; the senior tier only seniors.
      managerTierForSenior: asked(manager, "staff", "senior"),
      seniorTierForManager: asked(senior, "staff", "manager"),
      seniorTierForSenior: asked(senior, "staff", "senior"),
      seniorTierForSeniorsAgent: asked(senior, "agent", "senior"),
      // Credits ask only juniors.
      creditsForJunior: asked(credits, "staff", "junior"),
      creditsForSupport: asked(credits, "staff", "support"),
    }).toStrictEqual({
      managerTierForSenior: false,
      seniorTierForManager: true,
      seniorTierForSenior: false,
      seniorTierForSeniorsAgent: true,
      creditsForJunior: true,
      creditsForSupport: false,
    });
  });

  it("counts approvals per rule and role", () => {
    const signOffs = signOffsFor(
      rules.filter((rule) => rule.key === "credits"),
      staff,
      holding("junior")
    );
    const approved = { ruleKey: "credits", approverRole: "manager" };
    expect({
      signOffs,
      described: describeSignOffs([
        ...signOffs,
        { ruleKey: "x", approverRole: "senior", count: 1 },
      ]),
      one: unmetSignOff(signOffs, [{ ...approved, status: "approved" }]),
      two: unmetSignOff(signOffs, [
        { ...approved, status: "approved" },
        { ...approved, status: "approved" },
      ]),
      files: rulesForFiles(rules, ["config/roles/sales.yaml"]).length,
    }).toStrictEqual({
      signOffs: [{ ruleKey: "credits", approverRole: "manager", count: 2 }],
      described: "2 approvals from manager and 1 from senior",
      one: signOffs[0],
      two: undefined,
      files: 1,
    });
  });

  it.each([
    [
      "a list for eq",
      { when: [{ field: "input.a", operator: "eq", value: [1] }] },
    ],
    [
      "a field outside input and record",
      { when: [{ field: "a", operator: "eq", value: 1 }] },
    ],
    [
      "a record field with no record",
      { when: [{ field: "record.a", operator: "eq", value: 1 }] },
    ],
    ["no action or config", { action: undefined }],
    ["six approvals", { approvals: 6 }],
  ])("refuses %s", (_case, change) => {
    expect(
      approvalRuleSchema.safeParse({
        key: "x",
        label: "X",
        action: "deal_update",
        approver: "admin",
        ...change,
      }).success
    ).toBeFalsy();
  });
});
