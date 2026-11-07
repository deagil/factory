// Access → Roles: what each role lets its holders see and do, from
// `role.list` (P1b.06). Roles come from config; phase 2 edits them there.
import { createFileRoute } from "@tanstack/react-router";

import { useRoles } from "../../components/access.tsx";
import { ErrorText } from "../../components/activity.tsx";
import { PageHeader } from "../../components/page-header.tsx";

const verbs = ["view", "create", "update", "archive"];

const RolesScreen = () => {
  const roles = useRoles();
  return (
    <div className="flex flex-col gap-6">
      <PageHeader title="Roles" />
      <ErrorText error={roles.error} />
      {roles.data?.map((role) => {
        const objects = role.permissions.filter(
          (line): line is { object: string; can: string[]; scope: string } =>
            "object" in line
        );
        const actions = role.permissions.filter(
          (line): line is { action: string; scope: string } => "action" in line
        );
        return (
          <section key={role.key} className="flex flex-col gap-2">
            <h2 className="font-medium">
              {role.label}{" "}
              <span className="font-mono text-xs text-muted-foreground">
                {role.key}
              </span>
            </h2>
            {objects.length > 0 && (
              <div className="overflow-x-auto rounded-2xl border">
                <table className="w-full text-left text-sm">
                  <thead className="border-b bg-muted/50">
                    <tr>
                      <th className="px-3 py-2 font-medium">Object</th>
                      {verbs.map((verb) => (
                        <th
                          key={verb}
                          className="px-3 py-2 text-center font-medium capitalize"
                        >
                          {verb}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {objects.map((line) => (
                      <tr key={line.object} className="border-b last:border-0">
                        <td className="px-3 py-2">
                          {line.object === "*" ? "Every object" : line.object}
                        </td>
                        {verbs.map((verb) => (
                          <td key={verb} className="px-3 py-2 text-center">
                            {line.can.includes(verb) ? "✓" : ""}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            {actions.length > 0 && (
              <p className="text-sm">
                <span className="text-muted-foreground">Actions: </span>
                {actions
                  .map((line) =>
                    line.action === "*" ? "every action" : line.action
                  )
                  .join(", ")}
              </p>
            )}
            {role.permissions.length === 0 && (
              <p className="text-sm text-muted-foreground">No permissions.</p>
            )}
          </section>
        );
      })}
    </div>
  );
};

export const Route = createFileRoute("/_app/access/roles")({
  staticData: { section: "access" },
  component: RolesScreen,
});
