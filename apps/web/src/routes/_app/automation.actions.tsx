// Automation → Actions: what a workflow step can run, from `action_list`,
// for people who may read it; otherwise the operations the caller may run,
// from system.describe.
import { useQuery } from "@tanstack/react-query";
import { createFileRoute, useNavigate } from "@tanstack/react-router";

import { ErrorText, TextFilter, text } from "../../components/activity.tsx";
import { PageHeader } from "../../components/page-header.tsx";
import { describeSystem, readWorkflow } from "../../lib/api.ts";
import { humanise } from "../../lib/forms.ts";
import { actionListKey, mayCall } from "../../lib/workflow-events.ts";
import type { ActionListItem } from "../../lib/workflow-events.ts";

interface ActionsSearch {
  q?: string;
}

const cell = "px-3 py-2 align-top";

interface ActionRow {
  name: string;
  description: string;
  kind: string;
  emits: string[];
  /** Known only from `action_list`. */
  readOnly?: boolean;
  object?: string | undefined;
}

const fetchActions = async (): Promise<ActionRow[]> => {
  const result = await readWorkflow<{ actions: ActionListItem[] }>(
    actionListKey
  );
  return result.output.actions.map((action) => ({
    name: action.name,
    description: action.description,
    kind: action.kind,
    emits: action.emits,
    readOnly: action.read_only === true,
    object: action.object,
  }));
};

const marksOf = (action: ActionRow) =>
  [
    action.kind,
    ...(action.readOnly ? ["read only"] : []),
    ...(action.object ? [`on ${action.object}`] : []),
  ].join(", ");

const ActionsScreen = () => {
  const search = Route.useSearch();
  const navigate = useNavigate({ from: Route.fullPath });
  const described = useQuery({
    queryKey: ["system.describe"],
    queryFn: describeSystem,
  });
  const stepActions = useQuery({
    queryKey: [actionListKey],
    queryFn: fetchActions,
    enabled: mayCall(described.data?.workflows, actionListKey),
  });
  const all: ActionRow[] = stepActions.data ?? described.data?.actions ?? [];
  const q = search.q?.toLowerCase() ?? "";
  const actions = all
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
        {stepActions.data
          ? "What a workflow step can run. Nothing else reaches these; each run is in Activity."
          : "Operations this system can run. A workflow step calls one; each run is in Activity."}
      </p>
      <TextFilter
        key={search.q ?? ""}
        label="Find"
        placeholder="contact_create"
        value={search.q}
        onChange={(next) => navigate({ search: { q: next } })}
      />
      <ErrorText error={described.error ?? stepActions.error} />
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
                  <td className={`${cell} first-letter:uppercase`}>
                    {marksOf(action)}
                  </td>
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
