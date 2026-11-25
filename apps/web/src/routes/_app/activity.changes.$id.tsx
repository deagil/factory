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
  useRecordName,
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
  description: SystemDescription | undefined,
  liveName: string | undefined
) => {
  const object = findObject(description, change.object);
  const title =
    liveName ||
    titleOf({ id: change.recordId, ...change.before, ...change.after }, object);
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
  const change = found.data?.change;
  const live = useRecordName(
    change?.object ?? "",
    change?.recordId ?? "",
    described.data
  );

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
  const loaded = found.data.change;
  const object = findObject(described.data, loaded.object);
  return (
    <div className="flex max-w-4xl flex-col gap-6">
      <PageHeader
        title={headingFor(loaded, described.data, live.data)}
        trail={[...trail]}
      />
      <dl className="divide-y">
        <DetailRow label="Record">
          <RecordLink
            object={loaded.object}
            recordId={loaded.recordId}
            values={{ ...loaded.before, ...loaded.after }}
            description={described.data}
          />
        </DetailRow>
        <DetailRow label="Object">{object?.label ?? loaded.object}</DetailRow>
        <DetailRow label="By">
          <WhoDid who={loaded} />
        </DetailRow>
        <DetailRow label="Action">
          <RunLink id={loaded.runId}>{loaded.action}</RunLink>
        </DetailRow>
        <DetailRow label="When">{when(loaded.at)}</DetailRow>
        <DetailRow label="Step">
          <span className="font-mono text-xs">{loaded.stepId}</span>
        </DetailRow>
        <DetailRow label="Change ID">
          <span className="font-mono text-xs">{loaded.id}</span>
        </DetailRow>
      </dl>
      <DetailSection title="Fields">
        <ChangedFields
          object={loaded.object}
          before={loaded.before}
          after={loaded.after}
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
