// Automation → Workflows. People who may read workflows see every one.
// People who may only call them keep a Run form for each.
import { useQuery } from "@tanstack/react-query";
import { Link, createFileRoute, useNavigate } from "@tanstack/react-router";
import { Button } from "@workspace/ui/components/button";
import { useState } from "react";

import { ErrorText, text } from "../../components/activity.tsx";
import {
  DataTable,
  tableBodyRow,
  tableHeadCell,
} from "../../components/data-table.tsx";
import { LogFilterBar } from "../../components/log-filters.tsx";
import type { LogFilterSpec } from "../../components/log-filters.tsx";
import { OpenRow } from "../../components/open-row.tsx";
import { PageHeader } from "../../components/page-header.tsx";
import { NewWorkflowForm } from "../../components/workflow-edit.tsx";
import { useEventList } from "../../components/workflow-events.tsx";
import { WorkflowForm } from "../../components/workflow-form.tsx";
import { useWorkingDraft } from "../../components/working-draft.tsx";
import { describeSystem, readWorkflow } from "../../lib/api.ts";
import type { SystemDescription } from "../../lib/api.ts";
import { canEditConfig } from "../../lib/choice-lists.ts";
import type { WorkflowDescription } from "../../lib/forms.ts";
import {
  canReadWorkflows,
  draftChangeLabel,
  sourceLabel,
  versionForChange,
  whatStarts,
  workflowListKey,
} from "../../lib/workflows.ts";
import type { WorkflowListItem } from "../../lib/workflows.ts";

const cell = "px-3 py-2";

interface WorkflowsSearch {
  name?: string;
  starts?: string;
  source?: "code" | "config";
  change?: "added" | "changed" | "removed";
  call?: "GET" | "POST";
}

const sourceOf = (value: unknown): WorkflowsSearch["source"] =>
  value === "code" || value === "config" ? value : undefined;

const changeOf = (value: unknown): WorkflowsSearch["change"] =>
  value === "added" || value === "changed" || value === "removed"
    ? value
    : undefined;

const callOf = (value: unknown): WorkflowsSearch["call"] =>
  value === "GET" || value === "POST" ? value : undefined;

const contains = (needle: string | undefined, haystack: string) =>
  needle === undefined || haystack.toLowerCase().includes(needle.toLowerCase());

const page = "flex min-h-0 w-full max-w-4xl flex-1 flex-col gap-4";

const WorkflowCard = ({
  workflow,
  description,
}: {
  workflow: WorkflowDescription;
  description: SystemDescription | undefined;
}) => {
  const [open, setOpen] = useState(false);
  const errors = Object.entries(workflow.errors);
  return (
    <>
      <tr className={tableBodyRow}>
        <td className={cell}>
          <p className="font-medium">{workflow.label}</p>
          <p className="text-muted-foreground">{workflow.description}</p>
        </td>
        <td className={`${cell} font-mono text-xs text-muted-foreground`}>
          {workflow.readOnly ? "GET" : "POST"} /workflows/{workflow.key}
        </td>
        <td className={cell}>
          <Button
            variant="outline"
            size="sm"
            aria-expanded={open}
            onClick={() => setOpen((value) => !value)}
          >
            {open ? "Close" : "Run"}
          </Button>
        </td>
      </tr>
      {open ? (
        <tr className={tableBodyRow}>
          <td colSpan={3} className={cell}>
            {errors.length > 0 ? (
              <ul className="mb-3 text-sm text-muted-foreground">
                {errors.map(([code, message]) => (
                  <li key={code}>
                    <span className="font-mono text-xs">{code}</span>: {message}
                  </li>
                ))}
              </ul>
            ) : null}
            <WorkflowForm
              workflow={workflow}
              description={description}
              onCancel={() => setOpen(false)}
            />
          </td>
        </tr>
      ) : null}
    </>
  );
};

const RunForms = ({
  description,
}: {
  description: SystemDescription | undefined;
}) => {
  const search = Route.useSearch();
  const navigate = useNavigate({ from: Route.fullPath });
  const update = (next: Partial<WorkflowsSearch>) =>
    navigate({ search: (previous) => ({ ...previous, ...next }) });
  const workflows = description?.workflows ?? [];
  const filters: LogFilterSpec[] = [
    {
      key: "name",
      label: "Workflow",
      operator: "contains",
      kind: "text",
      placeholder: "deal",
    },
    {
      key: "call",
      label: "Call",
      operator: "is",
      kind: "choice",
      options: [
        { value: "GET", label: "GET" },
        { value: "POST", label: "POST" },
      ],
    },
  ];
  const filtering = search.name !== undefined || search.call !== undefined;
  const shown = workflows.filter(
    (workflow) =>
      contains(
        search.name,
        `${workflow.label} ${workflow.key} ${workflow.description}`
      ) &&
      (search.call === undefined ||
        (workflow.readOnly ? "GET" : "POST") === search.call)
  );
  return (
    <div className={page}>
      <PageHeader title="Workflows" />
      <p className="shrink-0 text-sm text-muted-foreground">
        Workflows your roles let you call.
      </p>
      <DataTable
        fill
        toolbar={
          <LogFilterBar
            filters={filters}
            values={{ name: search.name, call: search.call }}
            onChange={(key, value) => update({ [key]: value })}
            onClear={() => update({ name: undefined, call: undefined })}
          />
        }
      >
        <thead>
          <tr>
            <th scope="col" className={tableHeadCell}>
              Workflow
            </th>
            <th scope="col" className={tableHeadCell}>
              Call
            </th>
            <th scope="col" className={tableHeadCell}>
              <span className="sr-only">Run</span>
            </th>
          </tr>
        </thead>
        <tbody>
          {shown.map((workflow) => (
            <WorkflowCard
              key={workflow.key}
              workflow={workflow}
              description={description}
            />
          ))}
          {description && shown.length === 0 ? (
            <tr>
              <td
                colSpan={3}
                className="px-3 py-6 text-center text-muted-foreground"
              >
                {filtering
                  ? "No workflows match."
                  : "None of your roles lets you call a workflow."}
              </td>
            </tr>
          ) : null}
        </tbody>
      </DataTable>
    </div>
  );
};

const Mark = ({ children }: { children: string }) => (
  <span className="rounded-full bg-muted px-2 py-0.5 text-xs font-medium">
    {children}
  </span>
);

const ReaderList = ({
  workflows,
  error,
  loading,
  canAdd,
  draftId,
}: {
  workflows: WorkflowListItem[];
  error: Error | null;
  loading: boolean;
  canAdd: boolean;
  draftId: string | undefined;
}) => {
  const [creating, setCreating] = useState(false);
  const search = Route.useSearch();
  const navigate = useNavigate({ from: Route.fullPath });
  const update = (next: Partial<WorkflowsSearch>) =>
    navigate({ search: (previous) => ({ ...previous, ...next }) });
  const { events } = useEventList(draftId);
  const filters: LogFilterSpec[] = [
    {
      key: "name",
      label: "Workflow",
      operator: "contains",
      kind: "text",
      placeholder: "deal",
    },
    {
      key: "starts",
      label: "Starts",
      operator: "contains",
      kind: "text",
      placeholder: "someone runs",
    },
    {
      key: "source",
      label: "Source",
      operator: "is",
      kind: "choice",
      options: [
        { value: "code", label: "Code" },
        { value: "config", label: "Config" },
      ],
    },
    {
      key: "change",
      label: "Draft",
      operator: "is",
      kind: "choice",
      options: [
        { value: "added", label: "Added" },
        { value: "changed", label: "Changed" },
        { value: "removed", label: "Removed" },
      ],
    },
  ];
  const filtering =
    search.name !== undefined ||
    search.starts !== undefined ||
    search.source !== undefined ||
    search.change !== undefined;
  const shown = workflows.filter(
    (workflow) =>
      contains(
        search.name,
        `${workflow.label} ${workflow.key} ${workflow.description}`
      ) &&
      contains(search.starts, whatStarts(workflow.starts_when)) &&
      (search.source === undefined || workflow.source === search.source) &&
      (search.change === undefined || workflow.change === search.change)
  );
  return (
    <div className={page}>
      <PageHeader
        title="Workflows"
        actions={
          canAdd && !creating ? (
            <Button
              size="sm"
              variant="outline"
              onClick={() => setCreating(true)}
            >
              New workflow
            </Button>
          ) : null
        }
      />
      <p className="shrink-0 text-sm text-muted-foreground">
        Every workflow. Open one to see what starts it and how it is written.
      </p>
      {creating ? (
        <NewWorkflowForm
          taken={workflows.map((workflow) => workflow.key)}
          events={(events ?? []).map((event) => event.type)}
          onCancel={() => setCreating(false)}
          onCreated={(key) =>
            navigate({
              to: "/automation/workflows/$key",
              params: { key },
              search: { v: "draft" },
            })
          }
        />
      ) : null}
      <DataTable
        fill
        error={error?.message}
        toolbar={
          <LogFilterBar
            filters={filters}
            values={{
              name: search.name,
              starts: search.starts,
              source: search.source,
              change: search.change,
            }}
            onChange={(key, value) => update({ [key]: value })}
            onClear={() =>
              update({
                name: undefined,
                starts: undefined,
                source: undefined,
                change: undefined,
              })
            }
          />
        }
      >
        <thead>
          <tr>
            <th scope="col" className={tableHeadCell}>
              Workflow
            </th>
            <th scope="col" className={tableHeadCell}>
              Starts
            </th>
            <th scope="col" className={tableHeadCell}>
              Source
            </th>
          </tr>
        </thead>
        <tbody>
          {shown.map((workflow) => {
            const change = draftChangeLabel(workflow.change);
            const version = versionForChange(workflow.change);
            const openSearch =
              version === "draft" ? { v: "draft" as const } : {};
            return (
              <OpenRow
                key={workflow.key}
                onOpen={() =>
                  navigate({
                    to: "/automation/workflows/$key",
                    params: { key: workflow.key },
                    search: openSearch,
                  })
                }
              >
                <td className={cell}>
                  <Link
                    to="/automation/workflows/$key"
                    params={{ key: workflow.key }}
                    search={openSearch}
                    className="font-medium hover:underline"
                  >
                    {workflow.label}
                  </Link>
                  <p className="font-mono text-xs text-muted-foreground">
                    {workflow.key}
                  </p>
                  {workflow.description ? (
                    <p className="text-muted-foreground">
                      {workflow.description}
                    </p>
                  ) : null}
                </td>
                <td className={`${cell} min-w-48`}>
                  {whatStarts(workflow.starts_when)}
                </td>
                <td className={cell}>
                  <span className="flex flex-wrap gap-2">
                    <Mark>{sourceLabel(workflow.source)}</Mark>
                    {change ? <Mark>{change}</Mark> : null}
                  </span>
                </td>
              </OpenRow>
            );
          })}
          {loading ? (
            <tr>
              <td
                colSpan={3}
                className="px-3 py-6 text-center text-muted-foreground"
              >
                Loading…
              </td>
            </tr>
          ) : null}
          {!loading && error === null && shown.length === 0 ? (
            <tr>
              <td
                colSpan={3}
                className="px-3 py-6 text-center text-muted-foreground"
              >
                {filtering ? "No workflows match." : "There are no workflows."}
              </td>
            </tr>
          ) : null}
        </tbody>
      </DataTable>
    </div>
  );
};

const WorkflowsScreen = () => {
  const described = useQuery({
    queryKey: ["system.describe"],
    queryFn: describeSystem,
  });
  const draft = useWorkingDraft();
  const mayReadDrafts =
    described.data?.queries.some((query) => query.name === "draft.mine") ??
    false;
  const draftSettled =
    described.isSuccess && (!mayReadDrafts || draft !== undefined);
  const canRead = canReadWorkflows(described.data?.workflows);
  const listed = useQuery({
    queryKey: ["workflow_list", draft?.id ?? null],
    queryFn: async () => {
      const result = await readWorkflow<{ workflows: WorkflowListItem[] }>(
        workflowListKey,
        draft?.id ? { draft_id: draft.id } : {}
      );
      return result.output;
    },
    enabled: canRead && draftSettled,
  });

  if (described.isPending) {
    return (
      <>
        <PageHeader title="Workflows" />
        <p className="text-sm text-muted-foreground">Loading…</p>
      </>
    );
  }
  if (described.isError) {
    return (
      <>
        <PageHeader title="Workflows" />
        <ErrorText error={described.error} />
      </>
    );
  }
  if (!canRead) {
    return <RunForms description={described.data} />;
  }
  return (
    <ReaderList
      workflows={listed.data?.workflows ?? []}
      error={listed.error}
      loading={listed.isLoading}
      canAdd={canEditConfig(described.data)}
      draftId={draft?.id}
    />
  );
};

export const Route = createFileRoute("/_app/automation/workflows/")({
  component: WorkflowsScreen,
  staticData: { section: "automation" },
  validateSearch: (search: Record<string, unknown>): WorkflowsSearch => ({
    name: text(search.name),
    starts: text(search.starts),
    source: sourceOf(search.source),
    change: changeOf(search.change),
    call: callOf(search.call),
  }),
});
