// One run (P1b.03, P2.12): what went in and came out, who made it and for
// whom, the config it ran under, each step, and the changes and events it
// wrote. A change or event opens that log entry when the caller can read
// it; the record name still opens the record.
import { useQuery } from "@tanstack/react-query";
import { Link, createFileRoute, useNavigate } from "@tanstack/react-router";
import type { RunDetail, RunStepEntry } from "@workspace/actions";

import {
  ChangedFields,
  DetailRow,
  DetailSection,
  ErrorText,
  Json,
  RecordLink,
  StatusBadge,
  WhoDid,
  canQuery,
  when,
} from "../../components/activity.tsx";
import { opensItem } from "../../components/open-row.tsx";
import { PageHeader } from "../../components/page-header.tsx";
import { describeSystem, runQuery } from "../../lib/api.ts";
import { canReadWorkflows, runStepLink } from "../../lib/workflows.ts";

const stepState = (step: RunStepEntry) => {
  if (step.error) {
    return "failed";
  }
  return step.finishedAt ? "done" : "…";
};

/** The step's id, linked to its place in the workflow when that can be read. */
const StepName = ({
  link,
  stepId,
}: {
  link: ReturnType<typeof runStepLink>;
  stepId: string;
}) =>
  link ? (
    <Link
      to="/automation/workflows/$key"
      params={{ key: link.key }}
      search={link.search}
      className="underline underline-offset-2"
    >
      {stepId}
    </Link>
  ) : (
    stepId
  );

const RunScreen = () => {
  const { id } = Route.useParams();
  const navigate = useNavigate();
  const described = useQuery({
    queryKey: ["system.describe"],
    queryFn: describeSystem,
  });
  const found = useQuery({
    queryKey: ["run.get", id],
    queryFn: () => runQuery<{ run: RunDetail }>("run.get", { id }),
    retry: false,
  });
  const trail = [
    { label: "Workflow runs", link: { to: "/activity/runs" } },
  ] as const;

  if (found.isPending) {
    return (
      <>
        <PageHeader title="Loading…" trail={[...trail]} />
        <p className="text-sm text-muted-foreground">Loading…</p>
      </>
    );
  }
  if (found.isError) {
    return (
      <>
        <PageHeader title="Run" trail={[...trail]} />
        <ErrorText error={found.error} />
      </>
    );
  }
  const { run } = found.data;
  return (
    <div className="flex max-w-4xl flex-col gap-6">
      <PageHeader title={run.endpoint} trail={[...trail]} />
      <dl className="divide-y">
        <DetailRow label="Status">
          <StatusBadge status={run.status} dryRun={run.dryRun} />
        </DetailRow>
        <DetailRow label="By">
          <WhoDid who={run} />
        </DetailRow>
        <DetailRow label="Started">{when(run.at)}</DetailRow>
        <DetailRow label="Finished">
          {run.finishedAt ? when(run.finishedAt) : "—"}
        </DetailRow>
        <DetailRow label="Retry key">
          <span className="font-mono text-xs">{run.retryKey ?? "—"}</span>
        </DetailRow>
        <DetailRow label="Config">
          <span className="font-mono text-xs">
            {run.configSha ?? "not from git"}
          </span>
        </DetailRow>
        <DetailRow label="Run ID">
          <span className="font-mono text-xs">{run.id}</span>
        </DetailRow>
      </dl>
      {run.error ? (
        <DetailSection title="Error">
          <Json value={run.error} />
        </DetailSection>
      ) : null}
      <DetailSection title="Input">
        <Json value={run.input} />
      </DetailSection>
      <DetailSection title="Output">
        <Json value={run.output} />
      </DetailSection>
      <DetailSection title={`Steps (${run.steps.length})`}>
        {run.steps.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No steps have run yet.
          </p>
        ) : (
          <ol className="flex flex-col gap-2">
            {run.steps.map((step) => (
              <li key={step.id} className="rounded-2xl border p-3 text-sm">
                <div className="flex flex-wrap items-baseline gap-x-3">
                  <span className="font-mono text-xs font-medium">
                    <StepName
                      link={runStepLink({
                        endpoint: run.endpoint,
                        stepId: step.stepId,
                        configSha: run.configSha,
                        canRead: canReadWorkflows(described.data?.workflows),
                      })}
                      stepId={step.stepId}
                    />
                  </span>
                  {step.name === step.stepId ? null : (
                    <span className="font-mono text-xs text-muted-foreground">
                      {step.name}
                    </span>
                  )}
                  {step.attempt > 1 ? (
                    <span className="text-muted-foreground">
                      attempt {step.attempt}
                    </span>
                  ) : null}
                  <span className="text-muted-foreground">
                    {stepState(step)}
                  </span>
                </div>
                {step.error ? (
                  <div className="mt-2">
                    <Json value={step.error} />
                  </div>
                ) : null}
              </li>
            ))}
          </ol>
        )}
      </DetailSection>
      <DetailSection title={`Changes (${run.changes.length})`}>
        {run.changes.length === 0 ? (
          <p className="text-sm text-muted-foreground">No records changed.</p>
        ) : (
          <ul className="flex flex-col gap-2">
            {run.changes.map((change) => {
              const open = canQuery(described.data, "auditLog.get");
              return (
                <li
                  key={change.id}
                  {...(open
                    ? opensItem(() =>
                        navigate({
                          to: "/activity/changes/$id",
                          params: { id: change.id },
                        })
                      )
                    : {})}
                  className={
                    open
                      ? "cursor-pointer rounded-2xl border p-3 text-sm outline-none hover:bg-muted/40 focus-visible:bg-muted/40"
                      : "rounded-2xl border p-3 text-sm"
                  }
                >
                  <RecordLink
                    object={change.object}
                    recordId={change.recordId}
                    values={{ ...change.before, ...change.after }}
                    description={described.data}
                  />
                  <div className="mt-1">
                    <ChangedFields
                      object={change.object}
                      before={change.before}
                      after={change.after}
                      description={described.data}
                    />
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </DetailSection>
      <DetailSection title={`Events (${run.events.length})`}>
        {run.events.length === 0 ? (
          <p className="text-sm text-muted-foreground">No events.</p>
        ) : (
          <ul className="flex flex-col gap-2">
            {run.events.map((event) => {
              const open = canQuery(described.data, "eventLog.get");
              return (
                <li
                  key={event.id}
                  {...(open
                    ? opensItem(() =>
                        navigate({
                          to: "/activity/events/$id",
                          params: { id: event.id },
                        })
                      )
                    : {})}
                  className={
                    open
                      ? "flex cursor-pointer flex-col gap-2 rounded-2xl text-sm outline-none hover:bg-muted/40 focus-visible:bg-muted/40"
                      : "flex flex-col gap-2 text-sm"
                  }
                >
                  {open ? (
                    <Link
                      to="/activity/events/$id"
                      params={{ id: event.id }}
                      className="font-mono text-xs hover:underline"
                    >
                      {event.type}
                    </Link>
                  ) : (
                    <Link
                      to="/activity/events"
                      search={{ run: run.id }}
                      className="font-mono text-xs hover:underline"
                    >
                      {event.type}
                    </Link>
                  )}
                  <Json value={event.payload} />
                </li>
              );
            })}
          </ul>
        )}
      </DetailSection>
    </div>
  );
};

export const Route = createFileRoute("/_app/activity/runs/$id")({
  staticData: { section: "activity" },
  component: RunScreen,
});
