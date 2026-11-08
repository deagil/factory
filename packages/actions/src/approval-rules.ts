// Approval rules (P2.09, decisions 0042 and 0043): when an action or a draft
// needs sign-off, from which role and how many people. A rule is config,
// `config/approvals/<key>.yaml`; the pipeline's approve stage and the draft
// actions read the live ones from `ctx.config.approvals`. Conditions are
// field, operator and value, on the action's input or on the record it acts
// on; there are no expressions.
import { z } from "zod";

import type { Actor } from "./define-action.ts";
import type { Granted } from "./permissions.ts";

const key = z.string().regex(/^[a-z][a-z0-9-]*$/u);
const roles = z.array(key);

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

/**
 * One test. `field` starts with `input.` (the action's input) or `record.`
 * (the record the rule names), such as `record.amount.amount`.
 */
export const conditionSchema = z
  .strictObject({
    field: z
      .string()
      .regex(
        /^(?:input|record)(?:\.[a-zA-Z0-9]+)+$/u,
        "A field starts with input. or record., such as input.amount or record.amount.amount"
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
  /** How many different people with that role must approve. One by default. */
  approvals: z.number().int().min(1).max(5).optional(),
  /** The rule asks only actors holding one of these roles. Everyone by default. */
  requester: roles.min(1).optional(),
  /**
   * Staff holding one of these roles skip the rule. By default the approver
   * role, since they could approve it themselves; `[]` means nobody skips.
   */
  exempt: roles.optional(),
};

/**
 * A rule, as `config/approvals/<key>.yaml` holds it: either an action, with
 * optional conditions that must all hold, or the config types whose files a
 * draft can't publish without sign-off.
 */
export const approvalRuleSchema = z.union([
  z
    .strictObject({
      ...common,
      action: z.string().regex(/^[a-z][a-zA-Z0-9]*\.[a-z][a-zA-Z0-9]*$/u),
      /** The record conditions read: an object, and where its id is in the input. */
      record: z
        .strictObject({
          object: z.string().regex(/^[a-z][a-zA-Z0-9]*$/u),
          id: z
            .string()
            .regex(
              /^input(?:\.[a-zA-Z0-9]+)+$/u,
              "The record's id is a path into the input, such as input.id"
            ),
        })
        .optional(),
      when: z.array(conditionSchema).optional(),
    })
    .superRefine((rule, ctx) => {
      for (const [index, condition] of (rule.when ?? []).entries()) {
        if (condition.field.startsWith("record.") && !rule.record) {
          ctx.addIssue({
            code: "custom",
            path: ["when", index, "field"],
            message:
              "This tests the record, so the rule needs record: { object, id }",
          });
        }
      }
    }),
  z.strictObject({
    ...common,
    config: z.array(key).min(1),
  }),
]);

export type ApprovalRule = z.infer<typeof approvalRuleSchema>;
type ActionRule = Extract<ApprovalRule, { action: string }>;

/** What conditions read: the action's input, and the rule's record, if any. */
export interface RuleValues {
  readonly input: unknown;
  readonly record?: unknown;
}

/** The value at `path` (`input.…` or `record.…`) in `values`, or undefined. */
const at = (values: RuleValues, path: string): unknown => {
  const [root, ...parts] = path.split(".");
  let value: unknown = root === "record" ? values.record : values.input;
  for (const part of parts) {
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

/** Whether `condition` holds. A missing field is null. */
export const conditionHolds = (condition: Condition, values: RuleValues) => {
  const found = at(values, condition.field) ?? null;
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

/** Finds a record by object name and id; null when there's none. */
export type RecordLoader = (object: string, id: string) => Promise<unknown>;

/**
 * The rules on `action` whose conditions all hold for `input` and, where a
 * rule names one, its record. Each record is read once.
 */
export const rulesForAction = async (
  rules: readonly ApprovalRule[],
  action: string,
  input: unknown,
  load: RecordLoader
): Promise<ApprovalRule[]> => {
  const candidates = rules.filter(
    (rule): rule is ActionRule => "action" in rule && rule.action === action
  );
  const reads = new Map<string, Promise<unknown>>();
  const recordFor = (rule: ActionRule) => {
    if (!rule.record) {
      return Promise.resolve(null);
    }
    const id = at({ input }, rule.record.id);
    if (typeof id !== "string") {
      return Promise.resolve(null);
    }
    const cacheKey = `${rule.record.object}:${id}`;
    const read = reads.get(cacheKey) ?? load(rule.record.object, id);
    reads.set(cacheKey, read);
    return read;
  };
  const matched = await Promise.all(
    candidates.map(async (rule) => {
      const values = { input, record: await recordFor(rule) };
      return (rule.when ?? []).every((condition) =>
        conditionHolds(condition, values)
      )
        ? rule
        : null;
    })
  );
  return matched.filter((rule) => rule !== null);
};

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

/** One rule's sign-off: the role that decides, and how many people. */
export interface SignOff {
  readonly ruleKey: string;
  readonly approverRole: string;
  readonly count: number;
}

/**
 * The sign-offs `rules` ask of `actor`. A rule with `requester` asks only
 * holders of those roles. Staff holding an exempt role (by default the
 * approver role) skip it. Agents, integrations and automation never skip:
 * they always need a person.
 */
export const signOffsFor = (
  rules: readonly ApprovalRule[],
  actor: Actor,
  granted: Granted
): SignOff[] =>
  rules
    .filter((rule) => {
      const asked = rule.requester?.some((role) => granted.holds(role)) ?? true;
      const exempt =
        actor.kind === "staff" &&
        (rule.exempt ?? [rule.approver]).some((role) => granted.holds(role));
      return asked && !exempt;
    })
    .map((rule) => ({
      ruleKey: rule.key,
      approverRole: rule.approver,
      count: rule.approvals ?? 1,
    }));

/** An approval row, as far as checking sign-offs goes. */
interface Decided {
  readonly ruleKey: string;
  readonly approverRole: string;
  readonly status: string;
}

/** The first sign-off `rows` don't have enough approvals for, or undefined. */
export const unmetSignOff = (
  signOffs: readonly SignOff[],
  rows: readonly Decided[]
): SignOff | undefined =>
  signOffs.find(
    (signOff) =>
      rows.filter(
        (row) =>
          row.status === "approved" &&
          row.ruleKey === signOff.ruleKey &&
          row.approverRole === signOff.approverRole
      ).length < signOff.count
  );

/** "2 approvals from manager and 1 from senior", for messages. */
export const describeSignOffs = (signOffs: readonly SignOff[]): string =>
  signOffs
    .map(
      (each, index) =>
        `${each.count}${index === 0 ? ` approval${each.count === 1 ? "" : "s"}` : ""} from ${each.approverRole}`
    )
    .join(" and ");
