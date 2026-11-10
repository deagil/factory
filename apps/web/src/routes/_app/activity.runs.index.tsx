// Activity → Runs: every call that ran, newest first, filtered by
// endpoint, status or actor, with the filters and page in the URL (P1b.03,
// P2.12). Without run.list, the query shows only the caller's own runs.
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import type { RunEntry } from "@workspace/actions";

import {
  RunLink,
  Chip,
  ErrorText,
  Pager,
  SelectFilter,
  StatusBadge,
  TextFilter,
  WhoDid,
  pageSearch,
  text,
  when,
} from "../../components/activity.tsx";
import type { PageSearch } from "../../components/activity.tsx";
import { OpenRow } from "../../components/open-row.tsx";
import { PageHeader } from "../../components/page-header.tsx";
import { runQuery } from "../../lib/api.ts";

interface RunsSearch extends PageSearch {
  /** An endpoint prefix, as `contact.`. */
  name?: string;
  /** One workflow, by its exact key. */
  workflow?: string;
  status?: string;
  actor?: string;
}

const statuses = ["succeeded", "failed", "waiting", "rejected", "withdrawn"];

const RunsScreen = () => {
  const search = Route.useSearch();
  const navigate = useNavigate({ from: Route.fullPath });
  const page = useQuery({
    queryKey: ["run.list", search],
    queryFn: () =>
      runQuery<{ entries: RunEntry[]; nextCursor: string | null }>("run.list", {
        endpointPrefix: search.name,
        endpoint: search.workflow,
        status: search.status,
        actorId: search.actor,
        cursor: search.cursor,
        limit: 25,
      }),
    placeholderData: keepPreviousData,
  });

  // Any change but paging starts again from the first page.
  const update = (next: Partial<RunsSearch>) =>
    navigate({
      search: (previous) => ({
        ...previous,
        cursor: undefined,
        back: undefined,
        ...next,
      }),
    });

  const actorName =
    page.data?.entries.find((entry) => entry.actor.id === search.actor)?.actor
      .name ?? search.actor?.slice(0, 8);
  return (
    <div className="flex flex-col gap-4">
      <PageHeader title="Workflow runs" />
      <div className="flex flex-wrap items-center gap-3">
        <TextFilter
          key={search.name ?? ""}
          label="Endpoint"
          placeholder="contact. or contact_create"
          value={search.name}
          onChange={(name) => update({ name })}
        />
        <SelectFilter
          label="Status"
          value={search.status}
          options={statuses.map((status) => ({
            value: status,
            label: status.replaceAll("_", " "),
          }))}
          onChange={(status) => update({ status })}
        />
        {search.workflow ? (
          <Chip onRemove={() => update({ workflow: undefined })}>
            Workflow {search.workflow}
          </Chip>
        ) : null}
        {search.actor ? (
          <Chip onRemove={() => update({ actor: undefined })}>
            By {actorName}
          </Chip>
        ) : null}
      </div>
      <ErrorText error={page.error} />
      <div className="overflow-x-auto rounded-2xl border">
        <table className="w-full text-left text-sm">
          <thead className="border-b bg-muted/50">
            <tr>
              <th scope="col" className="px-3 py-2 font-medium">
                Endpoint
              </th>
              <th scope="col" className="px-3 py-2 font-medium">
                By
              </th>
              <th scope="col" className="px-3 py-2 font-medium">
                Status
              </th>
              <th scope="col" className="px-3 py-2 font-medium">
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

export const Route = createFileRoute("/_app/activity/runs/")({
  staticData: { section: "activity" },
  validateSearch: (search: Record<string, unknown>): RunsSearch => ({
    name: text(search.name),
    workflow: text(search.workflow),
    status: text(search.status),
    actor: text(search.actor),
    ...pageSearch(search),
  }),
  component: RunsScreen,
});
