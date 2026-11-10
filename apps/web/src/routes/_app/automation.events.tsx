// Automation → Events: every event with where it comes from and the
// workflows it starts, for people who may read `event_list`; otherwise the
// event types the caller's actions can emit.
// The record of what has happened is Activity → Event log.
import { useQuery } from "@tanstack/react-query";
import { createFileRoute, useNavigate } from "@tanstack/react-router";

import {
  ErrorText,
  Json,
  TextFilter,
  text,
} from "../../components/activity.tsx";
import { PageHeader } from "../../components/page-header.tsx";
import {
  StartedWorkflows,
  useEventList,
} from "../../components/workflow-events.tsx";
import { describeSystem } from "../../lib/api.ts";
import {
  eventSource,
  payloadOf,
  startedBy,
} from "../../lib/workflow-events.ts";
import type { EventListItem } from "../../lib/workflow-events.ts";
import { eventWords, titleOf } from "../../lib/workflow-words.ts";

interface EventsSearch {
  q?: string;
}

interface EventRow {
  type: string;
  payload: unknown;
  /** Known only from `event_list`. */
  listed: EventListItem | null;
}

const rowsOf = (
  listed: readonly EventListItem[] | undefined,
  described: readonly { type: string; payload: unknown }[]
): EventRow[] =>
  listed
    ? listed.map((event) => ({
        type: event.type,
        payload: payloadOf(event.payload),
        listed: event,
      }))
    : described.map((event) => ({ ...event, listed: null }));

const Starts = ({
  event,
  labels,
}: {
  event: EventListItem | null;
  labels: ReadonlyMap<string, string>;
}) => {
  const [starts] = event ? startedBy([event.type], [event], labels) : [];
  return event && starts ? (
    <div className="mt-1 flex flex-col gap-1 text-sm">
      <p className="text-muted-foreground">
        {eventSource(event.from)} emit it.
      </p>
      <div className="flex flex-wrap gap-x-2">
        <span>Starts:</span>
        <StartedWorkflows starts={starts} />
      </div>
    </div>
  ) : null;
};

const EventsScreen = () => {
  const search = Route.useSearch();
  const navigate = useNavigate({ from: Route.fullPath });
  const described = useQuery({
    queryKey: ["system.describe"],
    queryFn: describeSystem,
  });
  const eventList = useEventList();
  const q = search.q?.toLowerCase() ?? "";
  const events = rowsOf(eventList.events, described.data?.events ?? [])
    .filter((event) => q === "" || event.type.toLowerCase().includes(q))
    .toSorted((a, b) => a.type.localeCompare(b.type));
  return (
    <div className="flex max-w-4xl flex-col gap-4">
      <PageHeader title="Events" />
      <p className="text-sm text-muted-foreground">
        Things that can happen. A workflow can start when one of these is
        emitted. What has already happened is in the event log.
      </p>
      <TextFilter
        key={search.q ?? ""}
        label="Find"
        placeholder="contact.created"
        value={search.q}
        onChange={(next) => navigate({ search: { q: next } })}
      />
      <ErrorText error={described.error ?? eventList.error} />
      {described.isSuccess && events.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          {q === "" ? "No events you can see." : "No events match."}
        </p>
      ) : null}
      {events.length > 0 ? (
        <ul className="flex flex-col gap-2">
          {events.map((event) => (
            <li key={event.type} className="rounded-2xl border p-3">
              <p className="text-sm font-medium">
                {titleOf(eventWords(event.type))}
              </p>
              <p className="font-mono text-xs text-muted-foreground">
                {event.type}
              </p>
              <Starts event={event.listed} labels={eventList.labels} />
              <details className="mt-2 text-sm">
                <summary className="cursor-pointer text-muted-foreground">
                  Payload
                </summary>
                <div className="mt-2">
                  <Json value={event.payload} />
                </div>
              </details>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
};

export const Route = createFileRoute("/_app/automation/events")({
  staticData: { section: "automation" },
  validateSearch: (search: Record<string, unknown>): EventsSearch => ({
    q: text(search.q),
  }),
  component: EventsScreen,
});
