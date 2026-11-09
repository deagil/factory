// Activity → Changes: every field that changed on every record, newest
// first, from audit_log, with the action behind each one (P1b.03). Needs
// the auditLog.list permission.
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import type { ChangeEntry } from "@workspace/actions";

import {
  RunLink,
  ChangedFields,
  Chip,
  ErrorText,
  Pager,
  RecordLink,
  SelectFilter,
  TextFilter,
  WhoDid,
  pageSearch,
  text,
  when,
} from "../../components/activity.tsx";
import type { PageSearch } from "../../components/activity.tsx";
import { PageHeader } from "../../components/page-header.tsx";
import { describeSystem, runQuery } from "../../lib/api.ts";
import { plural } from "../../lib/nav.ts";

interface ChangesSearch extends PageSearch {
  object?: string;
  field?: string;
  record?: string;
  actor?: string;
  run?: string;
}

const ChangesScreen = () => {
  const search = Route.useSearch();
  const navigate = useNavigate({ from: Route.fullPath });
  const described = useQuery({
    queryKey: ["system.describe"],
    queryFn: describeSystem,
  });
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
          runId: search.run,
          cursor: search.cursor,
          limit: 25,
        }
      ),
    placeholderData: keepPreviousData,
  });

  const update = (next: Partial<ChangesSearch>) =>
    navigate({
      search: (previous) => ({
        ...previous,
        cursor: undefined,
        back: undefined,
        ...next,
      }),
    });

  const first = page.data?.entries[0];
  return (
    <div className="flex flex-col gap-4">
      <PageHeader title="Changes" />
      <div className="flex flex-wrap items-center gap-3">
        <SelectFilter
          label="Object"
          value={search.object}
          options={(described.data?.objects ?? []).map((object) => ({
            value: object.name,
            label: plural(object.label),
          }))}
          onChange={(object) => update({ object })}
        />
        <TextFilter
          key={search.field ?? ""}
          label="Field"
          placeholder="email"
          value={search.field}
          onChange={(field) => update({ field })}
        />
        {search.record ? (
          <Chip onRemove={() => update({ record: undefined })}>
            Record {search.record.slice(0, 8)}
          </Chip>
        ) : null}
        {search.actor ? (
          <Chip onRemove={() => update({ actor: undefined })}>
            By {first?.actor.name ?? search.actor.slice(0, 8)}
          </Chip>
        ) : null}
        {search.run ? (
          <Chip onRemove={() => update({ run: undefined })}>
            Run {search.run.slice(0, 8)}
          </Chip>
        ) : null}
      </div>
      <ErrorText error={page.error} />
      <div className="overflow-x-auto rounded-2xl border">
        <table className="w-full text-left text-sm">
          <thead className="border-b bg-muted/50">
            <tr>
              <th scope="col" className="px-3 py-2 font-medium">
                Record
              </th>
              <th scope="col" className="px-3 py-2 font-medium">
                Change
              </th>
              <th scope="col" className="px-3 py-2 font-medium">
                By
              </th>
              <th scope="col" className="px-3 py-2 font-medium">
                Action
              </th>
              <th scope="col" className="px-3 py-2 font-medium">
                When
              </th>
            </tr>
          </thead>
          <tbody>
            {page.data?.entries.map((entry) => (
              <tr
                key={entry.id}
                className="border-b align-top last:border-0 hover:bg-muted/30"
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
              </tr>
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
        </table>
      </div>
      <Pager
        search={search}
        nextCursor={page.data?.nextCursor}
        onPage={(next) =>
          navigate({ search: (previous) => ({ ...previous, ...next }) })
        }
      />
    </div>
  );
};

export const Route = createFileRoute("/_app/activity/changes")({
  staticData: { section: "activity" },
  validateSearch: (search: Record<string, unknown>): ChangesSearch => ({
    object: text(search.object),
    field: text(search.field),
    record: text(search.record),
    actor: text(search.actor),
    run: text(search.run),
    ...pageSearch(search),
  }),
  component: ChangesScreen,
});
