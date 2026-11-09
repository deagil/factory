// Approval rules as config: `config/approvals/<key>.yaml`, each a rule as
// `@workspace/actions` defines it (decision 0042).
import { approvalRuleSchema } from "@workspace/actions";
import type { ApprovalRule } from "@workspace/actions";

import { defineConfigType } from "./config-type.ts";
import type { Reference } from "./config-type.ts";

const roleRefs = (names: readonly string[] | undefined, field: string) =>
  (names ?? []).map((name, index) => ({
    kind: "role" as const,
    name,
    path: [field, index],
  }));

/** What a rule's action, record or config types are, as references. */
const targetReferences = (rule: ApprovalRule): Reference[] => {
  if ("config" in rule) {
    return rule.config.map((type, index) => ({
      kind: "configType" as const,
      name: type,
      path: ["config", index],
    }));
  }
  const { record } = rule;
  return [
    { kind: "anyAction", name: rule.action, path: ["action"] },
    ...(record
      ? [
          {
            kind: "object" as const,
            name: record.object,
            path: ["record", "object"],
          },
          // `record.amount.amount` names the field `amount`.
          ...(rule.when ?? []).flatMap((condition, index) => {
            const [root, field] = condition.field.split(".");
            return root === "record" && field
              ? [
                  {
                    kind: "field" as const,
                    name: `${record.object}.${field}`,
                    path: ["when", index, "field"],
                  },
                ]
              : [];
          }),
        ]
      : []),
  ];
};

/**
 * What a rule points to: its action and record, or the config types it
 * covers, and every role it names.
 */
export const approvalReferences = (rule: ApprovalRule): Reference[] => [
  ...targetReferences(rule),
  { kind: "role", name: rule.approver, path: ["approver"] },
  ...roleRefs(rule.requester, "requester"),
  ...roleRefs(rule.exempt, "exempt"),
];

export const approvalConfigType = defineConfigType<ApprovalRule>({
  type: "approvals",
  schema: approvalRuleSchema,
  references: approvalReferences,
});
