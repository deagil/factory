// Reading `event_list` and `workflow_list`, and showing the workflows an
// event starts, each linked to its page.
import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";

import { describeSystem, readWorkflow } from "../lib/api.ts";
import { eventListKey, labelsOf, mayCall } from "../lib/workflow-events.ts";
import type { EventListItem, EventStarts } from "../lib/workflow-events.ts";
import { workflowListKey } from "../lib/workflows.ts";
import type { WorkflowListItem } from "../lib/workflows.ts";

/** Every event with the workflows it starts, when the caller may read them. */
export const useEventList = (draftId?: string) => {
  const described = useQuery({
    queryKey: ["system.describe"],
    queryFn: describeSystem,
  });
  const allowed = mayCall(described.data?.workflows, eventListKey);
  const events = useQuery({
    queryKey: [eventListKey, draftId ?? null],
    queryFn: async () => {
      const result = await readWorkflow<{ events: EventListItem[] }>(
        eventListKey,
        draftId ? { draft_id: draftId } : {}
      );
      return result.output.events;
    },
    enabled: allowed,
  });
  const listed = useQuery({
    queryKey: [workflowListKey, draftId ?? null],
    queryFn: async () => {
      const result = await readWorkflow<{ workflows: WorkflowListItem[] }>(
        workflowListKey,
        draftId ? { draft_id: draftId } : {}
      );
      return result.output;
    },
    enabled: mayCall(described.data?.workflows, workflowListKey),
  });
  return {
    allowed,
    events: events.data,
    labels: labelsOf(listed.data?.workflows),
    error: events.error,
    isSuccess: events.isSuccess,
  };
};

/** The workflows an event starts, linked, or a line saying none do. */
export const StartedWorkflows = ({ starts }: { starts: EventStarts }) =>
  starts.workflows.length === 0 ? (
    <span className="text-muted-foreground">No workflow starts.</span>
  ) : (
    <ul className="flex flex-wrap gap-x-3 gap-y-1">
      {starts.workflows.map((workflow) => (
        <li key={workflow.key}>
          <Link
            to="/automation/workflows/$key"
            params={{ key: workflow.key }}
            className="font-medium underline underline-offset-2"
          >
            {workflow.label}
          </Link>
        </li>
      ))}
    </ul>
  );

/** Events as headings, each with the workflows it starts. */
export const EventStartsList = ({ rows }: { rows: EventStarts[] }) => (
  <dl className="flex flex-col gap-2 text-sm">
    {rows.map((row) => (
      <div key={row.type} className="flex flex-col gap-0.5">
        <dt>
          {row.heading}{" "}
          <span className="font-mono text-xs text-muted-foreground">
            {row.type}
          </span>
        </dt>
        <dd className="pl-3">
          <StartedWorkflows starts={row} />
        </dd>
      </div>
    ))}
  </dl>
);
