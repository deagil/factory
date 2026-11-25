// Activity → Changes: every field that changed on every record, newest
// first, from audit_log, with the action behind each one (P1b.03). Needs
// the auditLog.list permission.
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import type { ChangeEntry } from "@workspace/actions";

import {
  RunLink,
  ChangedFields,
  Pager,
  RecordLink,
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
import { describeSystem, runQuery } from "../../lib/api.ts";
import { day, dayEnd, dayStart } from "../../lib/day-range.ts";
import { plural } from "../../lib/nav.ts";

interface ChangesSearch extends PageSearch {
  object?: string;
  field?: string;
  record?: string;
  actor?: string;
  /** An action prefix, as `organisation_`. */
  action?: string;
  /** A calendar day, inclusive, as `YYYY-MM-DD`. */
  since?: string;
  until?: string;
  run?: string;
}

const ChangesScreen = () => {
  const search = Route.useSearch();
  const navigate = useNavigate({ from: Route.fullPath });
  const update = (next: Partial<ChangesSearch>) =>
    navigate({
      search: (previous) => ({
        ...previous,
        cursor: undefined,
        back: undefined,
        ...next,
      }),
    });
  const described = useQuery({
    queryKey: ["system.describe"],
    queryFn: describeSystem,
  });
  const people = useLogPeople("actor");
  const filters: LogFilterSpec[] = [
    {
      key: "object",
      label: "Object",
      operator: "is",
      kind: "choice",
      options: (described.data?.objects ?? []).map((object) => ({
        value: object.name,
        label: plural(object.label),
      })),
    },
    {
      key: "action",
      label: "Action",
      operator: "starts with",
      kind: "text",
      placeholder: "organisation_",
    },
    {
      key: "field",
      label: "Field",
      operator: "is",
      kind: "text",
      placeholder: "email",
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
  const pinned: PinnedFilter[] = [
    search.record
      ? {
          key: "record",
          label: "Record",
          operator: "is",
          value: search.record.slice(0, 8),
          onRemove: () => update({ record: undefined }),
        }
      : undefined,
    search.run
      ? {
          key: "run",
          label: "Run",
          operator: "is",
          value: search.run.slice(0, 8),
          onRemove: () => update({ run: undefined }),
        }
      : undefined,
  ].flatMap((pin) => (pin ? [pin] : []));
  const page = useQuery({
    queryKey: ["auditLog.list", search],
    queryFn: () =>
      runQuery<{ entries: ChangeEntry[]; nextCursor: string | null }>(
        "auditLog.list",
        {
          object: search.object,
          field: search.field,
          recordId: search.record,
          actorId: search.actor,
          actionPrefix: search.action,
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
      <PageHeader title="Audit log" />
      <DataTable
        fill
        error={page.error?.message}
        toolbar={
          <LogFilterBar
            filters={filters}
            values={{
              object: search.object,
              action: search.action,
              field: search.field,
              actor: search.actor,
              since: search.since,
              until: search.until,
            }}
            pinned={pinned}
            onChange={(key, value) => update({ [key]: value })}
            onClear={() =>
              update({
                object: undefined,
                action: undefined,
                field: undefined,
                actor: undefined,
                since: undefined,
                until: undefined,
                record: undefined,
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
              Record
            </th>
            <th scope="col" className={tableHeadCell}>
              Change
            </th>
            <th scope="col" className={tableHeadCell}>
              By
            </th>
            <th scope="col" className={tableHeadCell}>
              Action
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
                  to: "/activity/changes/$id",
                  params: { id: entry.id },
                })
              }
            >
              <td className="px-3 py-2">
                <RecordLink
                  object={entry.object}
                  recordId={entry.recordId}
                  values={{ ...entry.before, ...entry.after }}
                  description={described.data}
                />
              </td>
              <td className="px-3 py-2">
                <ChangedFields
                  object={entry.object}
                  before={entry.before}
                  after={entry.after}
                  description={described.data}
                />
              </td>
              <td className="px-3 py-2">
                <WhoDid who={entry} onActor={(actor) => update({ actor })} />
              </td>
              <td className="px-3 py-2">
                <RunLink id={entry.runId}>{entry.action}</RunLink>
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
                No changes match.
              </td>
            </tr>
          )}
        </tbody>
      </DataTable>
    </div>
  );
};

export const Route = createFileRoute("/_app/activity/changes/")({
  staticData: { section: "activity" },
  validateSearch: (search: Record<string, unknown>): ChangesSearch => ({
    object: text(search.object),
    field: text(search.field),
    record: text(search.record),
    actor: text(search.actor),
    action: text(search.action),
    since: day(search.since),
    until: day(search.until),
    run: text(search.run),
    ...pageSearch(search),
  }),
  component: ChangesScreen,
});
