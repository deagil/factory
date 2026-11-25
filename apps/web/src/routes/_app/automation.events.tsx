// Automation → Events: every event with where it comes from and the
// workflows it starts, for people who may read `event_list`; otherwise the
// event types the caller's actions can emit.
// The record of what has happened is Activity → Event log.
import { useQuery } from "@tanstack/react-query";
import { createFileRoute, useNavigate } from "@tanstack/react-router";

import { Json, text } from "../../components/activity.tsx";
import {
  DataTable,
  tableBodyRow,
  tableHeadCell,
} from "../../components/data-table.tsx";
import { LogFilterBar } from "../../components/log-filters.tsx";
import type { LogFilterSpec } from "../../components/log-filters.tsx";
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
  type?: string;
  starts?: string;
}

const contains = (needle: string | undefined, haystack: string) =>
  needle === undefined || haystack.toLowerCase().includes(needle.toLowerCase());

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
    <div className="flex flex-col gap-1">
      <p className="text-muted-foreground">
        {eventSource(event.from)} emit it.
      </p>
      <div className="flex flex-wrap gap-x-2">
        <span>Starts:</span>
        <StartedWorkflows starts={starts} />
      </div>
    </div>
  ) : (
    <span className="text-muted-foreground">—</span>
  );
};

const cell = "px-3 py-2";

const EventsScreen = () => {
  const search = Route.useSearch();
  const navigate = useNavigate({ from: Route.fullPath });
  const described = useQuery({
    queryKey: ["system.describe"],
    queryFn: describeSystem,
  });
  const eventList = useEventList();
  const update = (next: Partial<EventsSearch>) =>
    navigate({ search: (previous) => ({ ...previous, ...next }) });
  const filters: LogFilterSpec[] = [
    {
      key: "type",
      label: "Event",
      operator: "contains",
      kind: "text",
      placeholder: "contact_created",
    },
    {
      key: "starts",
      label: "Starts",
      operator: "contains",
      kind: "text",
      placeholder: "deal",
    },
  ];
  const filtering = search.type !== undefined || search.starts !== undefined;
  const events = rowsOf(eventList.events, described.data?.events ?? [])
    .filter((event) => {
      const [starts] = event.listed
        ? startedBy([event.type], [event.listed], eventList.labels)
        : [];
      const started = starts?.workflows
        .map((workflow) => workflow.label)
        .join(" ");
      return (
        contains(
          search.type,
          `${titleOf(eventWords(event.type))} ${event.type}`
        ) &&
        contains(
          search.starts,
          event.listed
            ? `${eventSource(event.listed.from)} ${started ?? ""}`
            : ""
        )
      );
    })
    .toSorted((a, b) => a.type.localeCompare(b.type));
  const problem = described.error ?? eventList.error;
  return (
    <div className="flex min-h-0 w-full max-w-4xl flex-1 flex-col gap-4">
      <PageHeader title="Events" />
      <p className="shrink-0 text-sm text-muted-foreground">
        Things that can happen. A workflow can start when one of these is
        emitted. What has already happened is in the event log.
      </p>
      <DataTable
        fill
        error={problem?.message}
        toolbar={
          <LogFilterBar
            filters={filters}
            values={{ type: search.type, starts: search.starts }}
            onChange={(key, value) => update({ [key]: value })}
            onClear={() => update({ type: undefined, starts: undefined })}
          />
        }
      >
        <thead>
          <tr>
            <th scope="col" className={tableHeadCell}>
              Event
            </th>
            <th scope="col" className={tableHeadCell}>
              Starts
            </th>
            <th scope="col" className={tableHeadCell}>
              Payload
            </th>
          </tr>
        </thead>
        <tbody>
          {events.map((event) => (
            <tr key={event.type} className={tableBodyRow}>
              <td className={cell}>
                <p className="font-medium">{titleOf(eventWords(event.type))}</p>
                <p className="font-mono text-xs text-muted-foreground">
                  {event.type}
                </p>
              </td>
              <td className={cell}>
                <Starts event={event.listed} labels={eventList.labels} />
              </td>
              <td className={`${cell} max-w-md`}>
                <details className="text-sm">
                  <summary
                    className="cursor-pointer text-muted-foreground"
                    aria-label={`Payload of ${event.type}`}
                  >
                    Payload
                  </summary>
                  <div className="mt-2">
                    <Json value={event.payload} />
                  </div>
                </details>
              </td>
            </tr>
          ))}
          {described.isSuccess && events.length === 0 ? (
            <tr>
              <td
                colSpan={3}
                className="px-3 py-6 text-center text-muted-foreground"
              >
                {filtering ? "No events match." : "No events you can see."}
              </td>
            </tr>
          ) : null}
        </tbody>
      </DataTable>
    </div>
  );
};

export const Route = createFileRoute("/_app/automation/events")({
  staticData: { section: "automation" },
  validateSearch: (search: Record<string, unknown>): EventsSearch => ({
    type: text(search.type),
    starts: text(search.starts),
  }),
  component: EventsScreen,
});
