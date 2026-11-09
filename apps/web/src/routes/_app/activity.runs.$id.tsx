// One run (P1b.03, P2.12): what went in and came out, who made it and for
// whom, the config it ran under, each step, and the changes and events it
// wrote, each linking to its record.
import { useQuery } from "@tanstack/react-query";
import { Link, createFileRoute } from "@tanstack/react-router";
import type { RunDetail, RunStepEntry } from "@workspace/actions";
import type { ReactNode } from "react";

import {
  ChangedFields,
  ErrorText,
  Json,
  RecordLink,
  StatusBadge,
  WhoDid,
  when,
} from "../../components/activity.tsx";
import { PageHeader } from "../../components/page-header.tsx";
import { describeSystem, runQuery } from "../../lib/api.ts";

const Row = ({ label, children }: { label: string; children: ReactNode }) => (
  <div className="grid grid-cols-[8rem_1fr] gap-3 py-1.5 text-sm">
    <dt className="text-muted-foreground">{label}</dt>
    <dd className="min-w-0 break-words">{children}</dd>
  </div>
);

const Section = ({
  title,
  children,
}: {
  title: string;
  children: ReactNode;
}) => (
  <section className="flex flex-col gap-2">
    <h2 className="text-sm font-medium">{title}</h2>
    {children}
  </section>
);

const stepState = (step: RunStepEntry) => {
  if (step.error) {
    return "failed";
  }
  return step.finishedAt ? "done" : "…";
};

const RunScreen = () => {
  const { id } = Route.useParams();
  const described = useQuery({
    queryKey: ["system.describe"],
    queryFn: describeSystem,
  });
  const found = useQuery({
    queryKey: ["run.get", id],
    queryFn: () => runQuery<{ run: RunDetail }>("run.get", { id }),
    retry: false,
  });
  const trail = [{ label: "Runs", link: { to: "/activity/runs" } }] as const;

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
        <Row label="Status">
          <StatusBadge status={run.status} dryRun={run.dryRun} />
        </Row>
        <Row label="By">
          <WhoDid who={run} />
        </Row>
        <Row label="Started">{when(run.at)}</Row>
        <Row label="Finished">
          {run.finishedAt ? when(run.finishedAt) : "—"}
        </Row>
        <Row label="Retry key">
          <span className="font-mono text-xs">{run.retryKey ?? "—"}</span>
        </Row>
        <Row label="Config">
          <span className="font-mono text-xs">
            {run.configSha ?? "not from git"}
          </span>
        </Row>
        <Row label="Run ID">
          <span className="font-mono text-xs">{run.id}</span>
        </Row>
      </dl>
      {run.error ? (
        <Section title="Error">
          <Json value={run.error} />
        </Section>
      ) : null}
      <Section title="Input">
        <Json value={run.input} />
      </Section>
      <Section title="Output">
        <Json value={run.output} />
      </Section>
      <Section title={`Steps (${run.steps.length})`}>
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
                    {step.stepId}
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
      </Section>
      <Section title={`Changes (${run.changes.length})`}>
        {run.changes.length === 0 ? (
          <p className="text-sm text-muted-foreground">No records changed.</p>
        ) : (
          <ul className="flex flex-col gap-2">
            {run.changes.map((change) => (
              <li key={change.id} className="rounded-2xl border p-3 text-sm">
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
            ))}
          </ul>
        )}
      </Section>
      <Section title={`Events (${run.events.length})`}>
        {run.events.length === 0 ? (
          <p className="text-sm text-muted-foreground">No events.</p>
        ) : (
          <ul className="flex flex-col gap-2">
            {run.events.map((event) => (
              <li key={event.id} className="flex flex-col gap-2 text-sm">
                <Link
                  to="/activity/events"
                  search={{ run: run.id }}
                  className="font-mono text-xs hover:underline"
                >
                  {event.type}
                </Link>
                <Json value={event.payload} />
              </li>
            ))}
          </ul>
        )}
      </Section>
    </div>
  );
};

export const Route = createFileRoute("/_app/activity/runs/$id")({
  staticData: { section: "activity" },
  component: RunScreen,
});
