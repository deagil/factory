// Automation → Workflows (P2.18): every workflow the caller may call, each
// with its form. Workflows that take a record also show as a button on it.
import { useQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { Button } from "@workspace/ui/components/button";
import { useState } from "react";

import { PageHeader } from "../../components/page-header.tsx";
import { WorkflowForm } from "../../components/workflow-form.tsx";
import { describeSystem } from "../../lib/api.ts";
import type { SystemDescription } from "../../lib/api.ts";
import type { WorkflowDescription } from "../../lib/forms.ts";

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

const WorkflowsScreen = () => {
  const described = useQuery({
    queryKey: ["system.describe"],
    queryFn: describeSystem,
  });
  const workflows = described.data?.workflows ?? [];
  return (
    <div className="flex flex-col gap-4">
      <PageHeader title="Workflows" />
      {described.isSuccess && workflows.length === 0 && (
        <p className="text-sm text-muted-foreground">
          None of your roles lets you call a workflow.
        </p>
      )}
      {workflows.map((workflow) => (
        <WorkflowCard
          key={workflow.key}
          workflow={workflow}
          description={described.data}
        />
      ))}
    </div>
  );
};

export const Route = createFileRoute("/_app/automation/workflows")({
  component: WorkflowsScreen,
  staticData: { section: "automation" },
});
