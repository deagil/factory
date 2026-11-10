// One audit log entry: the fields that changed, the record they belong to,
// and the run that wrote them.
import { useQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import type { ChangeEntry } from "@workspace/actions";

import {
  ChangedFields,
  DetailRow,
  DetailSection,
  ErrorText,
  RecordLink,
  RunLink,
  WhoDid,
  when,
} from "../../components/activity.tsx";
import { PageHeader } from "../../components/page-header.tsx";
import { describeSystem, runQuery } from "../../lib/api.ts";
import type { SystemDescription } from "../../lib/api.ts";
import { findObject, titleOf } from "../../lib/records.ts";

const trail = [
  { label: "Audit log", link: { to: "/activity/changes" } },
] as const;

const headingFor = (
  change: ChangeEntry,
  description: SystemDescription | undefined
) => {
  const object = findObject(description, change.object);
  const title = titleOf(
    { id: change.recordId, ...change.before, ...change.after },
    object
  );
  return title === change.recordId
    ? `${object?.label ?? change.object} change`
    : `Change to ${title}`;
};

const ChangeScreen = () => {
  const { id } = Route.useParams();
  const described = useQuery({
    queryKey: ["system.describe"],
    queryFn: describeSystem,
  });
  const found = useQuery({
    queryKey: ["auditLog.get", id],
    queryFn: () => runQuery<{ change: ChangeEntry }>("auditLog.get", { id }),
    retry: false,
  });

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
        <PageHeader title="Change" trail={[...trail]} />
        <ErrorText error={found.error} />
      </>
    );
  }
  const { change } = found.data;
  const object = findObject(described.data, change.object);
  return (
    <div className="flex max-w-4xl flex-col gap-6">
      <PageHeader
        title={headingFor(change, described.data)}
        trail={[...trail]}
      />
      <dl className="divide-y">
        <DetailRow label="Record">
          <RecordLink
            object={change.object}
            recordId={change.recordId}
            values={{ ...change.before, ...change.after }}
            description={described.data}
          />
        </DetailRow>
        <DetailRow label="Object">{object?.label ?? change.object}</DetailRow>
        <DetailRow label="By">
          <WhoDid who={change} />
        </DetailRow>
        <DetailRow label="Action">
          <RunLink id={change.runId}>{change.action}</RunLink>
        </DetailRow>
        <DetailRow label="When">{when(change.at)}</DetailRow>
        <DetailRow label="Step">
          <span className="font-mono text-xs">{change.stepId}</span>
        </DetailRow>
        <DetailRow label="Change ID">
          <span className="font-mono text-xs">{change.id}</span>
        </DetailRow>
      </dl>
      <DetailSection title="Fields">
        <ChangedFields
          object={change.object}
          before={change.before}
          after={change.after}
          description={described.data}
        />
      </DetailSection>
    </div>
  );
};

export const Route = createFileRoute("/_app/activity/changes/$id")({
  staticData: { section: "activity" },
  component: ChangeScreen,
});
