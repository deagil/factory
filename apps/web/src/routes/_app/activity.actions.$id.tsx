// One action that ran (P1b.03): what went in and came out, who ran it and
// for whom, the config it ran under, and the changes and events it wrote,
// each linking to its record.
import { useQuery } from "@tanstack/react-query";
import { Link, createFileRoute } from "@tanstack/react-router";
import type { ActionLogDetail } from "@workspace/actions";
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

const ActionScreen = () => {
  const { id } = Route.useParams();
  const described = useQuery({
    queryKey: ["system.describe"],
    queryFn: describeSystem,
  });
  const found = useQuery({
    queryKey: ["actionLog.get", id],
    queryFn: () =>
      runQuery<{ action: ActionLogDetail }>("actionLog.get", { id }),
    retry: false,
  });
  const trail = [
    { label: "Actions", link: { to: "/activity/actions" } },
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
        <PageHeader title="Action" trail={[...trail]} />
        <ErrorText error={found.error} />
      </>
    );
  }
  const { action } = found.data;
  return (
    <div className="flex max-w-4xl flex-col gap-6">
      <PageHeader title={action.name} trail={[...trail]} />
      <dl className="divide-y">
        <Row label="Status">
          <StatusBadge status={action.status} dryRun={action.dryRun} />
        </Row>
        <Row label="By">
          <WhoDid who={action} />
        </Row>
        <Row label="Started">{when(action.at)}</Row>
        <Row label="Finished">
          {action.completedAt ? when(action.completedAt) : "—"}
        </Row>
        <Row label="Retry key">
          <span className="font-mono text-xs">{action.retryKey ?? "—"}</span>
        </Row>
        <Row label="Config">
          <span className="font-mono text-xs">
            {action.configSha ?? "not from git"}
          </span>
        </Row>
        <Row label="Action ID">
          <span className="font-mono text-xs">{action.id}</span>
        </Row>
      </dl>
      {action.error ? (
        <Section title="Error">
          <Json value={action.error} />
        </Section>
      ) : null}
      <Section title="Input">
        <Json value={action.input} />
      </Section>
      <Section title="Result">
        <Json value={action.result} />
      </Section>
      <Section title={`Changes (${action.changes.length})`}>
        {action.changes.length === 0 ? (
          <p className="text-sm text-muted-foreground">No records changed.</p>
        ) : (
          <ul className="flex flex-col gap-2">
            {action.changes.map((change) => (
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
      <Section title={`Events (${action.events.length})`}>
        {action.events.length === 0 ? (
          <p className="text-sm text-muted-foreground">No events.</p>
        ) : (
          <ul className="flex flex-col gap-2">
            {action.events.map((event) => (
              <li key={event.id} className="flex flex-col gap-2 text-sm">
                <Link
                  to="/activity/events"
                  search={{ action: action.id }}
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

export const Route = createFileRoute("/_app/activity/actions/$id")({
  staticData: { section: "activity" },
  component: ActionScreen,
});
