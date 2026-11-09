// A workflow's form (P2.18): its input as fields, run as one call to
// `POST /workflows/<key>`. A record's button fills the input that takes the
// record; the Workflows page shows every field.
import { useMutation } from "@tanstack/react-query";
import { useState } from "react";

import { runWorkflow } from "../lib/api.ts";
import type { SystemDescription } from "../lib/api.ts";
import {
  fromFormValues,
  toFormValues,
  workflowFormFields,
} from "../lib/forms.ts";
import type { FormValues, WorkflowDescription } from "../lib/forms.ts";
import { RunLink } from "./activity.tsx";
import { RecordForm } from "./record-form.tsx";

const nothingFixed: Record<string, unknown> = {};

export const WorkflowForm = ({
  workflow,
  description,
  fixed = nothingFixed,
  onDone,
  onCancel,
}: {
  workflow: WorkflowDescription;
  description: SystemDescription | undefined;
  /** Input the screen fills itself, such as the record a button is on. */
  fixed?: Record<string, unknown>;
  onDone?: () => unknown;
  onCancel?: () => void;
}) => {
  const fields = workflowFormFields(workflow, Object.keys(fixed)[0]);
  const [runId, setRunId] = useState<string | null>(null);
  const run = useMutation({
    mutationFn: (values: FormValues) =>
      runWorkflow(workflow.key, {
        ...fromFormValues(fields, values),
        ...fixed,
      }),
    onSuccess: async (result) => {
      setRunId(result.runId);
      await onDone?.();
    },
  });
  return (
    <div className="flex flex-col gap-3">
      <RecordForm
        fields={fields}
        initial={toFormValues(fields)}
        description={description}
        submitLabel={workflow.label}
        pending={run.isPending}
        error={run.error}
        onSubmit={(values) => run.mutate(values)}
        onCancel={onCancel}
      />
      {runId && (
        <output className="text-sm text-muted-foreground">
          Done. <RunLink id={runId}>See the run</RunLink>
        </output>
      )}
    </div>
  );
};
