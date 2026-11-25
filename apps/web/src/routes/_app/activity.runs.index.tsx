// Activity → Runs: every call that ran, newest first, filtered by
// endpoint, status or actor, with the filters and page in the URL (P1b.03,
// P2.12). Without run.list, the query shows only the caller's own runs.
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import type { RunEntry } from "@workspace/actions";

import {
  RunLink,
  Pager,
  StatusBadge,
  WhoDid,
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

interface RunsSearch extends PageSearch {
  /** An endpoint prefix, as `contact.`. */
  name?: string;
  /** One workflow, by its exact key. */
  workflow?: string;
  status?: string;
  actor?: string;
  /** A calendar day, inclusive, as `YYYY-MM-DD`. */
  since?: string;
  until?: string;
}

const statuses = [
  "running",
  "waiting",
  "succeeded",
  "failed",
  "needs_attention",
  "resolved",
  "rejected",
  "withdrawn",
  "cancelled",
];

const RunsScreen = () => {
  const search = Route.useSearch();
  const navigate = useNavigate({ from: Route.fullPath });
  const update = (next: Partial<RunsSearch>) =>
    navigate({
      search: (previous) => ({
        ...previous,
        cursor: undefined,
        back: undefined,
        ...next,
      }),
    });
  const people = useLogPeople("actor");
  const filters: LogFilterSpec[] = [
    {
      key: "name",
      label: "Endpoint",
      operator: "starts with",
      kind: "text",
      placeholder: "contact_",
    },
    {
      key: "status",
      label: "Status",
      operator: "is",
      kind: "choice",
      options: statuses.map((status) => ({
        value: status,
        label: status.replaceAll("_", " "),
      })),
    },
    {
      key: "actor",
      label: "By",
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
  const pinned: PinnedFilter[] = search.workflow
    ? [
        {
          key: "workflow",
          label: "Workflow",
          operator: "is",
          value: search.workflow,
          onRemove: () => update({ workflow: undefined }),
        },
      ]
    : [];
  const page = useQuery({
    queryKey: ["run.list", search],
    queryFn: () =>
      runQuery<{ entries: RunEntry[]; nextCursor: string | null }>("run.list", {
        endpointPrefix: search.name,
        endpoint: search.workflow,
        status: search.status,
        actorId: search.actor,
        since: dayStart(search.since),
        until: dayEnd(search.until),
        cursor: search.cursor,
        limit: 25,
      }),
    placeholderData: keepPreviousData,
  });

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <PageHeader title="Workflow runs" />
      <DataTable
        fill
        error={page.error?.message}
        toolbar={
          <LogFilterBar
            filters={filters}
            values={{
              name: search.name,
              status: search.status,
              actor: search.actor,
              since: search.since,
              until: search.until,
            }}
            pinned={pinned}
            onChange={(key, value) => update({ [key]: value })}
            onClear={() =>
              update({
                name: undefined,
                status: undefined,
                actor: undefined,
                since: undefined,
                until: undefined,
                workflow: undefined,
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
              Endpoint
            </th>
            <th scope="col" className={tableHeadCell}>
              By
            </th>
            <th scope="col" className={tableHeadCell}>
              Status
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
                  to: "/activity/runs/$id",
                  params: { id: entry.id },
                })
              }
            >
              <td className="px-3 py-2">
                <RunLink id={entry.id}>{entry.endpoint}</RunLink>
              </td>
              <td className="px-3 py-2">
                <WhoDid who={entry} onActor={(actor) => update({ actor })} />
              </td>
              <td className="px-3 py-2">
                <StatusBadge status={entry.status} dryRun={entry.dryRun} />
              </td>
              <td className="px-3 py-2 whitespace-nowrap text-muted-foreground tabular-nums">
                {when(entry.at)}
              </td>
            </OpenRow>
          ))}
          {page.data?.entries.length === 0 && (
            <tr>
              <td
                colSpan={4}
                className="px-3 py-6 text-center text-muted-foreground"
              >
                No runs match.
              </td>
            </tr>
          )}
        </tbody>
      </DataTable>
    </div>
  );
};

export const Route = createFileRoute("/_app/activity/runs/")({
  staticData: { section: "activity" },
  validateSearch: (search: Record<string, unknown>): RunsSearch => ({
    name: text(search.name),
    workflow: text(search.workflow),
    status: text(search.status),
    actor: text(search.actor),
    since: day(search.since),
    until: day(search.until),
    ...pageSearch(search),
  }),
  component: RunsScreen,
});
