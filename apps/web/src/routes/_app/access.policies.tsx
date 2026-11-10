// Access → Policies: the approval rules, from the config files the caller
// can read. Each says when a change needs sign-off and from which role.
import { useQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";

import { ErrorText } from "../../components/activity.tsx";
import { PageHeader } from "../../components/page-header.tsx";
import { describeSystem, runQuery } from "../../lib/api.ts";
import { humanise } from "../../lib/forms.ts";

interface ConfigFile {
  path: string;
  type: string;
  key: string;
  value: unknown;
}

interface Policy {
  key: string;
  label: string;
  description?: string;
  approver: string;
  approvals?: number;
  action?: string;
  config?: string[];
}

const cell = "px-3 py-2 align-top";

const policyOf = (value: unknown, key: string): Policy | null => {
  if (typeof value !== "object" || value === null) {
    return null;
  }
  const rule = value as Record<string, unknown>;
  if (typeof rule.label !== "string" || typeof rule.approver !== "string") {
    return null;
  }
  return {
    key: typeof rule.key === "string" ? rule.key : key,
    label: rule.label,
    description:
      typeof rule.description === "string" ? rule.description : undefined,
    approver: rule.approver,
    approvals: typeof rule.approvals === "number" ? rule.approvals : undefined,
    action: typeof rule.action === "string" ? rule.action : undefined,
    config: Array.isArray(rule.config)
      ? rule.config.filter((name) => typeof name === "string")
      : undefined,
  };
};

const covers = (policy: Policy) => {
  if (policy.action) {
    return humanise(policy.action);
  }
  if (policy.config && policy.config.length > 0) {
    return policy.config.map((name) => humanise(name)).join(", ");
  }
  return "—";
};

const approver = (policy: Policy) => {
  const role = humanise(policy.approver);
  return policy.approvals && policy.approvals > 1
    ? `${policy.approvals} from ${role}`
    : role;
};

const PoliciesScreen = () => {
  const described = useQuery({
    queryKey: ["system.describe"],
    queryFn: describeSystem,
  });
  const allowed = described.data?.queries.some(
    (query) => query.name === "draft.files"
  );
  const files = useQuery({
    queryKey: ["draft.files", "mine"],
    queryFn: () =>
      runQuery<{ draftId: string | null; files: ConfigFile[] }>(
        "draft.files",
        {}
      ),
    enabled: allowed === true,
  });
  const policies = (files.data?.files ?? [])
    .filter((file) => file.type === "approvals")
    .flatMap((file) => {
      const policy = policyOf(file.value, file.key);
      return policy ? [policy] : [];
    })
    .toSorted((a, b) => a.label.localeCompare(b.label));
  return (
    <div className="flex max-w-4xl flex-col gap-4">
      <PageHeader title="Policies" />
      <p className="text-sm text-muted-foreground">
        When a change needs someone else to sign it off, and from which role.
      </p>
      {described.data && allowed === false ? (
        <p className="text-sm text-muted-foreground">
          Your roles don’t let you read approval rules.
        </p>
      ) : null}
      <ErrorText error={files.error} />
      {files.data && policies.length === 0 ? (
        <p className="text-sm text-muted-foreground">No approval rules.</p>
      ) : null}
      {policies.length > 0 ? (
        <div className="overflow-x-auto rounded-2xl border">
          <table className="w-full text-left text-sm">
            <thead className="border-b bg-muted/50">
              <tr>
                <th className={`${cell} font-medium`}>Policy</th>
                <th className={`${cell} font-medium`}>Covers</th>
                <th className={`${cell} font-medium`}>Approver</th>
              </tr>
            </thead>
            <tbody>
              {policies.map((policy) => (
                <tr key={policy.key} className="border-b last:border-0">
                  <td className={cell}>
                    <p className="font-medium">{policy.label}</p>
                    <p className="font-mono text-xs text-muted-foreground">
                      {policy.key}
                    </p>
                    {policy.description ? (
                      <p className="mt-1 text-muted-foreground">
                        {policy.description}
                      </p>
                    ) : null}
                  </td>
                  <td className={cell}>{covers(policy)}</td>
                  <td className={cell}>{approver(policy)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
    </div>
  );
};

export const Route = createFileRoute("/_app/access/policies")({
  staticData: { section: "access" },
  component: PoliciesScreen,
});
