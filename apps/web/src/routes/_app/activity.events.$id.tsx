// One event log entry: its type and payload, and the run that emitted it.
import { useQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import type { EventEntry } from "@workspace/actions";

import {
  DetailRow,
  DetailSection,
  ErrorText,
  Json,
  RunLink,
  when,
} from "../../components/activity.tsx";
import { PageHeader } from "../../components/page-header.tsx";
import { runQuery } from "../../lib/api.ts";

const trail = [
  { label: "Event log", link: { to: "/activity/events" } },
] as const;

const EventScreen = () => {
  const { id } = Route.useParams();
  const found = useQuery({
    queryKey: ["eventLog.get", id],
    queryFn: () => runQuery<{ event: EventEntry }>("eventLog.get", { id }),
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
        <PageHeader title="Event" trail={[...trail]} />
        <ErrorText error={found.error} />
      </>
    );
  }
  const { event } = found.data;
  return (
    <div className="flex max-w-4xl flex-col gap-6">
      <PageHeader title={event.type} trail={[...trail]} />
      <dl className="divide-y">
        <DetailRow label="When">{when(event.at)}</DetailRow>
        <DetailRow label="Run">
          {event.runId ? (
            <RunLink id={event.runId}>{event.runId}</RunLink>
          ) : (
            "—"
          )}
        </DetailRow>
        <DetailRow label="Step">
          <span className="font-mono text-xs">{event.stepId ?? "—"}</span>
        </DetailRow>
        <DetailRow label="For">{event.origin?.name ?? "—"}</DetailRow>
        <DetailRow label="Dispatched">
          {event.dispatchedAt ? when(event.dispatchedAt) : "Not yet"}
        </DetailRow>
        <DetailRow label="Depth">{event.depth}</DetailRow>
        <DetailRow label="Event ID">
          <span className="font-mono text-xs">{event.id}</span>
        </DetailRow>
      </dl>
      <DetailSection title="Payload">
        <Json value={event.payload} />
      </DetailSection>
    </div>
  );
};

export const Route = createFileRoute("/_app/activity/events/$id")({
  staticData: { section: "activity" },
  component: EventScreen,
});
