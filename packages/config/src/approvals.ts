// Approval rules as config: `config/approvals/<key>.yaml`, each a rule as
// `@workspace/actions` defines it (P2.09, decision 0042).
import { approvalRuleSchema } from "@workspace/actions";
import type { ApprovalRule } from "@workspace/actions";

import { defineConfigType } from "./config-type.ts";
import type { Reference } from "./config-type.ts";

/** The action or config types a rule covers, and the role that approves. */
export const approvalReferences = (rule: ApprovalRule): Reference[] => [
  ...("action" in rule
    ? [{ kind: "anyAction" as const, name: rule.action, path: ["action"] }]
    : rule.config.map((type, index) => ({
        kind: "configType" as const,
        name: type,
        path: ["config", index],
      }))),
  { kind: "role", name: rule.approver, path: ["approver"] },
];

export const approvalConfigType = defineConfigType<ApprovalRule>({
  type: "approvals",
  schema: approvalRuleSchema,
  references: approvalReferences,
});
