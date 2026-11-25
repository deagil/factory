// Activity → Events: what actions emitted, newest first, with payloads
// and the action behind each (P1b.03). In phase 2 workflows listen to
// these. Needs the eventLog.list permission.
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import type { EventEntry } from "@workspace/actions";

import {
  RunLink,
  Pager,
  pageSearch,
  text,
  when,
} from "../../components/activity.tsx";
import type { PageSearch } from "../../components/activity.tsx";
import { DataTable, tableHeadCell } from "../../components/data-table.tsx";
import { LogFilterBar, useLogPeople } from "../../components/log-filters.tsx";
import type {
  LogFilterSpec,
  PinnedFilter,
} from "../../components/log-filters.tsx";
import { OpenRow } from "../../components/open-row.tsx";
import { PageHeader } from "../../components/page-header.tsx";
import { runQuery } from "../../lib/api.ts";
import { day, dayEnd, dayStart } from "../../lib/day-range.ts";
import { payloadLines } from "../../lib/payload-lines.ts";

interface EventsSearch extends PageSearch {
  /** A type prefix, as `contact.`. */
  type?: string;
  /** The person the event was for. */
  for?: string;
  /** A calendar day, inclusive, as `YYYY-MM-DD`. */
  since?: string;
  until?: string;
  run?: string;
}

const EventsScreen = () => {
  const search = Route.useSearch();
  const navigate = useNavigate({ from: Route.fullPath });
  const update = (next: Partial<EventsSearch>) =>
    navigate({
      search: (previous) => ({
        ...previous,
        cursor: undefined,
        back: undefined,
        ...next,
      }),
    });
  const people = useLogPeople("user");
  const filters: LogFilterSpec[] = [
    {
      key: "type",
      label: "Type",
      operator: "starts with",
      kind: "text",
      placeholder: "contact_",
    },
    {
      key: "for",
      label: "For",
      operator: "is",
      kind: "choice",
      options: people,
    },
    {
      key: "since",
      label: "When",
      operator: "from",
      kind: "date",
    },
    {
      key: "until",
      label: "When",
      operator: "until",
      kind: "date",
    },
  ];
  const pinned: PinnedFilter[] = search.run
    ? [
        {
          key: "run",
          label: "Run",
          operator: "is",
          value: search.run.slice(0, 8),
          onRemove: () => update({ run: undefined }),
        },
      ]
    : [];
  const page = useQuery({
    queryKey: ["eventLog.list", search],
    queryFn: () =>
      runQuery<{ entries: EventEntry[]; nextCursor: string | null }>(
        "eventLog.list",
        {
          typePrefix: search.type,
          originUserId: search.for,
          since: dayStart(search.since),
          until: dayEnd(search.until),
          runId: search.run,
          cursor: search.cursor,
          limit: 25,
        }
      ),
    placeholderData: keepPreviousData,
  });

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <PageHeader title="Event log" />
      <DataTable
        fill
        error={page.error?.message}
        toolbar={
          <LogFilterBar
            filters={filters}
            values={{
              type: search.type,
              for: search.for,
              since: search.since,
              until: search.until,
            }}
            pinned={pinned}
            onChange={(key, value) => update({ [key]: value })}
            onClear={() =>
              update({
                type: undefined,
                for: undefined,
                since: undefined,
                until: undefined,
                run: undefined,
              })
            }
          />
        }
        footer={
          <Pager
            search={search}
            nextCursor={page.data?.nextCursor}
            onPage={(next) =>
              navigate({ search: (previous) => ({ ...previous, ...next }) })
            }
          />
        }
      >
        <thead>
          <tr>
            <th scope="col" className={tableHeadCell}>
              Type
            </th>
            <th scope="col" className={tableHeadCell}>
              Payload
            </th>
            <th scope="col" className={tableHeadCell}>
              For
            </th>
            <th scope="col" className={tableHeadCell}>
              Run
            </th>
            <th scope="col" className={tableHeadCell}>
              When
            </th>
          </tr>
        </thead>
        <tbody>
          {page.data?.entries.map((entry) => (
            <OpenRow
              key={entry.id}
              onOpen={() =>
                navigate({
                  to: "/activity/events/$id",
                  params: { id: entry.id },
                })
              }
            >
              <td className="px-3 py-2">
                <p className="font-mono text-xs font-medium">{entry.type}</p>
                <p className="text-muted-foreground">
                  {entry.dispatchedAt ? "Dispatched" : "Not dispatched yet"}
                </p>
              </td>
              <td className="max-w-md px-3 py-2 font-mono text-xs text-muted-foreground">
                {payloadLines(entry.payload).map((line, index) => (
                  <p key={index} className="truncate">
                    {line}
                  </p>
                ))}
              </td>
              <td className="px-3 py-2">
                {entry.origin ? (
                  <button
                    type="button"
                    className="font-medium hover:underline"
                    title={`Only for ${entry.origin.name}`}
                    onClick={() => update({ for: entry.origin?.id })}
                  >
                    {entry.origin.name}
                  </button>
                ) : (
                  "—"
                )}
              </td>
              <td className="px-3 py-2">
                {entry.runId ? <RunLink id={entry.runId}>run</RunLink> : "—"}
              </td>
              <td className="px-3 py-2 whitespace-nowrap text-muted-foreground tabular-nums">
                {when(entry.at)}
              </td>
            </OpenRow>
          ))}
          {page.data?.entries.length === 0 && (
            <tr>
              <td
                colSpan={5}
                className="px-3 py-6 text-center text-muted-foreground"
              >
                No events match.
              </td>
            </tr>
          )}
        </tbody>
      </DataTable>
    </div>
  );
};

export const Route = createFileRoute("/_app/activity/events/")({
  staticData: { section: "activity" },
  validateSearch: (search: Record<string, unknown>): EventsSearch => ({
    type: text(search.type),
    for: text(search.for),
    since: day(search.since),
    until: day(search.until),
    run: text(search.run),
    ...pageSearch(search),
  }),
  component: EventsScreen,
});
