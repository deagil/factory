// Automation → Actions: what a workflow step can run, from `action_list`,
// for people who may read it; otherwise the operations the caller may run,
// from system.describe.
import { useQuery } from "@tanstack/react-query";
import { createFileRoute, useNavigate } from "@tanstack/react-router";

import { text } from "../../components/activity.tsx";
import {
  DataTable,
  tableBodyRow,
  tableHeadCell,
} from "../../components/data-table.tsx";
import { LogFilterBar } from "../../components/log-filters.tsx";
import type { LogFilterSpec } from "../../components/log-filters.tsx";
import { PageHeader } from "../../components/page-header.tsx";
import { describeSystem, readWorkflow } from "../../lib/api.ts";
import { humanise } from "../../lib/forms.ts";
import { actionListKey, mayCall } from "../../lib/workflow-events.ts";
import type { ActionListItem } from "../../lib/workflow-events.ts";

interface ActionsSearch {
  name?: string;
  kind?: "internal" | "external";
  object?: string;
  emits?: string;
}

const kindOf = (value: unknown): ActionsSearch["kind"] =>
  value === "internal" || value === "external" ? value : undefined;

const contains = (needle: string | undefined, haystack: string) =>
  needle === undefined || haystack.toLowerCase().includes(needle.toLowerCase());

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
  const update = (next: Partial<ActionsSearch>) =>
    navigate({ search: (previous) => ({ ...previous, ...next }) });
  const all: ActionRow[] = stepActions.data ?? described.data?.actions ?? [];
  const objects = [
    ...new Set(all.flatMap((action) => (action.object ? [action.object] : []))),
  ].toSorted();
  const filters: LogFilterSpec[] = [
    {
      key: "name",
      label: "Action",
      operator: "contains",
      kind: "text",
      placeholder: "contact_create",
    },
    {
      key: "kind",
      label: "Kind",
      operator: "is",
      kind: "choice",
      options: [
        { value: "internal", label: "Internal" },
        { value: "external", label: "External" },
      ],
    },
    ...(objects.length > 0 || search.object
      ? [
          {
            key: "object",
            label: "Object",
            operator: "is",
            kind: "choice" as const,
            options: objects.map((object) => ({
              value: object,
              label: humanise(object),
            })),
          },
        ]
      : []),
    {
      key: "emits",
      label: "Emits",
      operator: "contains",
      kind: "text",
      placeholder: "contact_created",
    },
  ];
  const filtering =
    search.name !== undefined ||
    search.kind !== undefined ||
    search.object !== undefined ||
    search.emits !== undefined;
  const actions = all
    .filter(
      (action) =>
        contains(
          search.name,
          `${humanise(action.name)} ${action.name} ${action.description}`
        ) &&
        (search.kind === undefined || action.kind === search.kind) &&
        (search.object === undefined || action.object === search.object) &&
        contains(search.emits, action.emits.join(" "))
    )
    .toSorted((a, b) => a.name.localeCompare(b.name));
  const problem = described.error ?? stepActions.error;
  return (
    <div className="flex min-h-0 w-full max-w-4xl flex-1 flex-col gap-4">
      <PageHeader title="Actions" />
      <p className="shrink-0 text-sm text-muted-foreground">
        {stepActions.data
          ? "What a workflow step can run. Nothing else reaches these; each run is in Activity."
          : "Operations this system can run. A workflow step calls one; each run is in Activity."}
      </p>
      <DataTable
        fill
        error={problem?.message}
        toolbar={
          <LogFilterBar
            filters={filters}
            values={{
              name: search.name,
              kind: search.kind,
              object: search.object,
              emits: search.emits,
            }}
            onChange={(key, value) => update({ [key]: value })}
            onClear={() =>
              update({
                name: undefined,
                kind: undefined,
                object: undefined,
                emits: undefined,
              })
            }
          />
        }
      >
        <thead>
          <tr>
            <th scope="col" className={tableHeadCell}>
              Action
            </th>
            <th scope="col" className={tableHeadCell}>
              Kind
            </th>
            <th scope="col" className={tableHeadCell}>
              Emits
            </th>
          </tr>
        </thead>
        <tbody>
          {actions.map((action) => (
            <tr key={action.name} className={tableBodyRow}>
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
              <td
                className={`${cell} whitespace-nowrap first-letter:uppercase`}
              >
                {marksOf(action)}
              </td>
              <td
                className={`${cell} font-mono text-xs whitespace-nowrap text-muted-foreground`}
              >
                {action.emits.length > 0 ? action.emits.join(", ") : "—"}
              </td>
            </tr>
          ))}
          {described.isSuccess && actions.length === 0 ? (
            <tr>
              <td
                colSpan={3}
                className="px-3 py-6 text-center text-muted-foreground"
              >
                {filtering
                  ? "No actions match."
                  : "None of your roles lets you run an action."}
              </td>
            </tr>
          ) : null}
        </tbody>
      </DataTable>
    </div>
  );
};

export const Route = createFileRoute("/_app/automation/actions")({
  staticData: { section: "automation" },
  validateSearch: (search: Record<string, unknown>): ActionsSearch => ({
    name: text(search.name),
    kind: kindOf(search.kind),
    object: text(search.object),
    emits: text(search.emits),
  }),
  component: ActionsScreen,
});
