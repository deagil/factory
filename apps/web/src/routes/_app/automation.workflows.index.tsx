// Automation → Workflows. People who may read workflows see every one.
// People who may only call them keep a Run form for each.
import { useQuery } from "@tanstack/react-query";
import { Link, createFileRoute } from "@tanstack/react-router";
import { Button } from "@workspace/ui/components/button";
import { useState } from "react";

import { ErrorText } from "../../components/activity.tsx";
import { PageHeader } from "../../components/page-header.tsx";
import { WorkflowForm } from "../../components/workflow-form.tsx";
import { useWorkingDraft } from "../../components/working-draft.tsx";
import { describeSystem, readWorkflow } from "../../lib/api.ts";
import type { SystemDescription } from "../../lib/api.ts";
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
    <section className="flex flex-col gap-3 rounded-2xl border p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="font-medium">{workflow.label}</h2>
          <p className="text-sm text-muted-foreground">
            {workflow.description}
          </p>
          <p className="mt-1 font-mono text-xs text-muted-foreground">
            {workflow.readOnly ? "GET" : "POST"} /workflows/{workflow.key}
          </p>
        </div>
        <Button
          variant="outline"
          aria-expanded={open}
          onClick={() => setOpen((value) => !value)}
        >
          {open ? "Close" : "Run"}
        </Button>
      </div>
      {errors.length > 0 && (
        <ul className="text-sm text-muted-foreground">
          {errors.map(([code, message]) => (
            <li key={code}>
              <span className="font-mono text-xs">{code}</span>: {message}
            </li>
          ))}
        </ul>
      )}
      {open && (
        <WorkflowForm
          workflow={workflow}
          description={description}
          onCancel={() => setOpen(false)}
        />
      )}
    </section>
  );
};

const RunForms = ({
  description,
}: {
  description: SystemDescription | undefined;
}) => {
  const workflows = description?.workflows ?? [];
  return (
    <div className="flex flex-col gap-4">
      <PageHeader title="Workflows" />
      {description && workflows.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          None of your roles lets you call a workflow.
        </p>
      ) : null}
      {workflows.map((workflow) => (
        <WorkflowCard
          key={workflow.key}
          workflow={workflow}
          description={description}
        />
      ))}
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
}: {
  workflows: WorkflowListItem[];
  error: Error | null;
  loading: boolean;
}) => (
  <div className="flex max-w-4xl flex-col gap-4">
    <PageHeader title="Workflows" />
    <p className="text-sm text-muted-foreground">
      Every workflow. Open one to see what starts it and how it is written.
    </p>
    <ErrorText error={error} />
    {loading ? <p className="text-sm text-muted-foreground">Loading…</p> : null}
    {!loading && workflows.length === 0 && error === null ? (
      <p className="text-sm text-muted-foreground">There are no workflows.</p>
    ) : null}
    <ul className="flex flex-col gap-2">
      {workflows.map((workflow) => {
        const change = draftChangeLabel(workflow.change);
        const version = versionForChange(workflow.change);
        return (
          <li key={workflow.key}>
            <Link
              to="/automation/workflows/$key"
              params={{ key: workflow.key }}
              search={version === "draft" ? { v: "draft" } : {}}
              className="flex flex-col gap-1 rounded-2xl border p-4 outline-none hover:bg-muted/40 focus-visible:ring-3 focus-visible:ring-ring/30"
            >
              <span className="font-medium">{workflow.label}</span>
              <span className="font-mono text-xs text-muted-foreground">
                {workflow.key}
              </span>
              {workflow.description ? (
                <span className="text-sm text-muted-foreground">
                  {workflow.description}
                </span>
              ) : null}
              <span className="text-sm">
                {whatStarts(workflow.starts_when)}
              </span>
              <span className="flex flex-wrap gap-2">
                <Mark>{sourceLabel(workflow.source)}</Mark>
                {change ? <Mark>{change}</Mark> : null}
              </span>
            </Link>
          </li>
        );
      })}
    </ul>
  </div>
);

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
    />
  );
};

export const Route = createFileRoute("/_app/automation/workflows/")({
  component: WorkflowsScreen,
  staticData: { section: "automation" },
});
