// Automation → Actions: the operations the caller may run, from
// system.describe. Workflow steps run them.
import { useQuery } from "@tanstack/react-query";
import { createFileRoute, useNavigate } from "@tanstack/react-router";

import { ErrorText, TextFilter, text } from "../../components/activity.tsx";
import { PageHeader } from "../../components/page-header.tsx";
import { describeSystem } from "../../lib/api.ts";
import { humanise } from "../../lib/forms.ts";

interface ActionsSearch {
  q?: string;
}

const cell = "px-3 py-2 align-top";

const ActionsScreen = () => {
  const search = Route.useSearch();
  const navigate = useNavigate({ from: Route.fullPath });
  const described = useQuery({
    queryKey: ["system.describe"],
    queryFn: describeSystem,
  });
  const q = search.q?.toLowerCase() ?? "";
  const actions = (described.data?.actions ?? [])
    .filter(
      (action) =>
        q === "" ||
        action.name.toLowerCase().includes(q) ||
        action.description.toLowerCase().includes(q)
    )
    .toSorted((a, b) => a.name.localeCompare(b.name));
  return (
    <div className="flex max-w-4xl flex-col gap-4">
      <PageHeader title="Actions" />
      <p className="text-sm text-muted-foreground">
        Operations this system can run. A workflow step calls one; each run is
        in Activity.
      </p>
      <TextFilter
        key={search.q ?? ""}
        label="Find"
        placeholder="contact_create"
        value={search.q}
        onChange={(next) => navigate({ search: { q: next } })}
      />
      <ErrorText error={described.error} />
      {described.isSuccess && actions.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          {q === ""
            ? "None of your roles lets you run an action."
            : "No actions match."}
        </p>
      ) : null}
      {actions.length > 0 ? (
        <div className="overflow-x-auto rounded-2xl border">
          <table className="w-full text-left text-sm">
            <thead className="border-b bg-muted/50">
              <tr>
                <th className={`${cell} font-medium`}>Action</th>
                <th className={`${cell} font-medium`}>Kind</th>
                <th className={`${cell} font-medium`}>Emits</th>
              </tr>
            </thead>
            <tbody>
              {actions.map((action) => (
                <tr key={action.name} className="border-b last:border-0">
                  <td className={cell}>
                    <p className="font-medium">{humanise(action.name)}</p>
                    <p className="font-mono text-xs text-muted-foreground">
                      {action.name}
                    </p>
                    {action.description ? (
                      <p className="mt-1 text-muted-foreground">
                        {action.description}
                      </p>
                    ) : null}
                  </td>
                  <td className={`${cell} capitalize`}>{action.kind}</td>
                  <td
                    className={`${cell} font-mono text-xs text-muted-foreground`}
                  >
                    {action.emits.length > 0 ? action.emits.join(", ") : "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
    </div>
  );
};

export const Route = createFileRoute("/_app/automation/actions")({
  staticData: { section: "automation" },
  validateSearch: (search: Record<string, unknown>): ActionsSearch => ({
    q: text(search.q),
  }),
  component: ActionsScreen,
});
