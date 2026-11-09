// Access → Roles: what each role lets its holders see and do, from
// `role.list`. Per object: the endpoints it may call, whose rows and which
// fields it may read and write (P2.14); then the workflows it may call.
// Roles come from config and are edited in a draft.
import { createFileRoute } from "@tanstack/react-router";

import { useRoles } from "../../components/access.tsx";
import { ErrorText } from "../../components/activity.tsx";
import { PageHeader } from "../../components/page-header.tsx";
import {
  fieldListText,
  jobsOf,
  objectJobs,
  objectName,
  workflowsOf,
} from "../../lib/roles.ts";

const cell = "px-3 py-2";

const RolesScreen = () => {
  const roles = useRoles();
  return (
    <div className="flex flex-col gap-6">
      <PageHeader title="Roles" />
      <ErrorText error={roles.error} />
      {roles.data?.map((role) => {
        const objects = Object.entries(role.objects ?? {});
        const workflows = workflowsOf(role);
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
                      <th className={`${cell} font-medium`}>Object</th>
                      {objectJobs.map((job) => (
                        <th
                          key={job}
                          className={`${cell} text-center font-medium capitalize`}
                        >
                          {job}
                        </th>
                      ))}
                      <th className={`${cell} font-medium`}>Rows</th>
                      <th className={`${cell} font-medium`}>Reads</th>
                      <th className={`${cell} font-medium`}>Writes</th>
                    </tr>
                  </thead>
                  <tbody>
                    {objects.map(([object, rules]) => {
                      const jobs = jobsOf(rules);
                      return (
                        <tr key={object} className="border-b last:border-0">
                          <td className={cell}>{objectName(object)}</td>
                          {objectJobs.map((job) => (
                            <td key={job} className={`${cell} text-center`}>
                              {jobs.includes(job) ? "✓" : ""}
                            </td>
                          ))}
                          <td className={cell}>
                            {rules.rows === "own" ? "Own" : "All"}
                          </td>
                          <td className={cell}>{fieldListText(rules.read)}</td>
                          <td className={cell}>{fieldListText(rules.write)}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
            {workflows.length > 0 && (
              <p className="text-sm">
                <span className="text-muted-foreground">Workflows: </span>
                {workflows
                  .map((name) => (name === "*" ? "every workflow" : name))
                  .join(", ")}
              </p>
            )}
            {objects.length === 0 && workflows.length === 0 && (
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
