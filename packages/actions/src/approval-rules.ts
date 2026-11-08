// Approval rules (P2.09, decision 0042): when an action or a draft needs
// sign-off, and from which role. A rule is config, `config/approvals/<key>.yaml`;
// the pipeline's approve stage and the draft actions read the live ones from
// `ctx.config.approvals`. Conditions are field, operator and value, tested
// against the action's input; there are no expressions.
import { z } from "zod";

import type { Actor } from "./define-action.ts";
import type { Granted } from "./permissions.ts";

const key = z.string().regex(/^[a-z][a-z0-9-]*$/u);

export const conditionOperators = [
  "eq",
  "ne",
  "in",
  "notIn",
  "gt",
  "gte",
  "lt",
  "lte",
] as const;

const scalar = z.union([z.string(), z.number(), z.boolean(), z.null()]);
type Scalar = z.infer<typeof scalar>;

/** One test on the action's input: `field` is a path such as `lines.0.amount`. */
export const conditionSchema = z
  .strictObject({
    field: z
      .string()
      .regex(
        /^[a-zA-Z][a-zA-Z0-9]*(?:\.[a-zA-Z0-9]+)*$/u,
        "A field is a path into the action's input, such as amount or customer.id"
      ),
    operator: z.enum(conditionOperators),
    value: z.union([scalar, z.array(scalar).min(1)]),
  })
  .superRefine((condition, ctx) => {
    const list = condition.operator === "in" || condition.operator === "notIn";
    if (list !== Array.isArray(condition.value)) {
      ctx.addIssue({
        code: "custom",
        path: ["value"],
        message: list
          ? `${condition.operator} needs a list of values`
          : `${condition.operator} needs one value, not a list`,
      });
    }
  });

export type Condition = z.infer<typeof conditionSchema>;

const common = {
  key,
  label: z.string().min(1),
  description: z.string().max(500).optional(),
  /** The role whose holders may approve. */
  approver: key,
};

/**
 * A rule, as `config/approvals/<key>.yaml` holds it: either an action, with
 * optional conditions that must all hold, or the config types whose files a
 * draft can't publish without sign-off.
 */
export const approvalRuleSchema = z.union([
  z.strictObject({
    ...common,
    action: z.string().regex(/^[a-z][a-zA-Z0-9]*\.[a-z][a-zA-Z0-9]*$/u),
    when: z.array(conditionSchema).optional(),
  }),
  z.strictObject({
    ...common,
    config: z.array(key).min(1),
  }),
]);

export type ApprovalRule = z.infer<typeof approvalRuleSchema>;

/** The value at `path` in `input`, or undefined. */
const at = (input: unknown, path: string): unknown => {
  let value = input;
  for (const part of path.split(".")) {
    if (value === null || typeof value !== "object") {
      return undefined;
    }
    value = (value as Record<string, unknown>)[part];
  }
  return value;
};

const ordered = (left: unknown, right: Scalar | Scalar[]) =>
  (typeof left === "number" && typeof right === "number") ||
  (typeof left === "string" && typeof right === "string");

/** Whether `condition` holds for `input`. A missing field is null. */
export const conditionHolds = (condition: Condition, input: unknown) => {
  const found = at(input, condition.field) ?? null;
  const { value } = condition;
  switch (condition.operator) {
    case "eq": {
      return found === value;
    }
    case "ne": {
      return found !== value;
    }
    case "in": {
      return (value as Scalar[]).includes(found as Scalar);
    }
    case "notIn": {
      return !(value as Scalar[]).includes(found as Scalar);
    }
    default: {
      if (!ordered(found, value)) {
        return false;
      }
      const [left, right] = [
        found as number | string,
        value as number | string,
      ];
      return {
        gt: left > right,
        gte: left >= right,
        lt: left < right,
        lte: left <= right,
      }[condition.operator];
    }
  }
};

/** The rules on `action` whose conditions all hold for `input`. */
export const rulesForAction = (
  rules: readonly ApprovalRule[],
  action: string,
  input: unknown
): ApprovalRule[] =>
  rules.filter(
    (rule) =>
      "action" in rule &&
      rule.action === action &&
      (rule.when ?? []).every((condition) => conditionHolds(condition, input))
  );

/** The rules covering any of `files` (`config/<type>/<key>.yaml`). */
export const rulesForFiles = (
  rules: readonly ApprovalRule[],
  files: readonly string[]
): ApprovalRule[] =>
  rules.filter(
    (rule) =>
      "config" in rule &&
      files.some((file) => rule.config.includes(file.split("/")[1] ?? ""))
  );

/**
 * The sign-offs `rules` ask of `actor`. Staff who hold a rule's approver
 * role could approve it themselves, so that rule doesn't apply to them.
 * Agents, integrations and automation always need a person.
 */
export const signOffsFor = (
  rules: readonly ApprovalRule[],
  actor: Actor,
  granted: Granted
): { ruleKey: string; approverRole: string }[] =>
  rules
    .filter((rule) => !(actor.kind === "staff" && granted.holds(rule.approver)))
    .map((rule) => ({ ruleKey: rule.key, approverRole: rule.approver }));
