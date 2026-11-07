// Activity → Events: what actions emitted, newest first, with payloads
// and the action behind each (P1b.03). In phase 2 workflows listen to
// these. Needs the eventLog.list permission.
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import type { EventEntry } from "@workspace/actions";

import {
  ActionLink,
  Chip,
  ErrorText,
  Json,
  Pager,
  TextFilter,
  pageSearch,
  text,
  when,
} from "../../components/activity.tsx";
import type { PageSearch } from "../../components/activity.tsx";
import { PageHeader } from "../../components/page-header.tsx";
import { runQuery } from "../../lib/api.ts";

interface EventsSearch extends PageSearch {
  /** A type prefix, as `contact.`. */
  type?: string;
  action?: string;
}

const EventsScreen = () => {
  const search = Route.useSearch();
  const navigate = useNavigate({ from: Route.fullPath });
  const page = useQuery({
    queryKey: ["eventLog.list", search],
    queryFn: () =>
      runQuery<{ entries: EventEntry[]; nextCursor: string | null }>(
        "eventLog.list",
        {
          typePrefix: search.type,
          actionId: search.action,
          cursor: search.cursor,
          limit: 25,
        }
      ),
    placeholderData: keepPreviousData,
  });

  const update = (next: Partial<EventsSearch>) =>
    navigate({
      search: (previous) => ({
        ...previous,
        cursor: undefined,
        back: undefined,
        ...next,
      }),
    });

  return (
    <div className="flex flex-col gap-4">
      <PageHeader title="Events" />
      <div className="flex flex-wrap items-center gap-3">
        <TextFilter
          key={search.type ?? ""}
          label="Type"
          placeholder="contact. or contact.created"
          value={search.type}
          onChange={(type) => update({ type })}
        />
        {search.action ? (
          <Chip onRemove={() => update({ action: undefined })}>
            Action {search.action.slice(0, 8)}
          </Chip>
        ) : null}
      </div>
      <ErrorText error={page.error} />
      <ol className="flex flex-col gap-3">
        {page.data?.entries.map((entry) => (
          <li key={entry.id} className="rounded-2xl border p-3 text-sm">
            <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
              <span className="font-mono text-xs font-medium">
                {entry.type}
              </span>
              <ActionLink id={entry.actionId}>action</ActionLink>
              {entry.origin ? (
                <span className="text-muted-foreground">
                  for {entry.origin.name}
                </span>
              ) : null}
              <span className="text-muted-foreground">
                {entry.dispatchedAt ? "dispatched" : "not dispatched yet"}
              </span>
              <span className="ml-auto text-muted-foreground tabular-nums">
                {when(entry.at)}
              </span>
            </div>
            <div className="mt-2">
              <Json value={entry.payload} />
            </div>
          </li>
        ))}
        {page.data?.entries.length === 0 && (
          <li className="py-6 text-center text-sm text-muted-foreground">
            No events match.
          </li>
        )}
      </ol>
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

export const Route = createFileRoute("/_app/activity/events")({
  staticData: { section: "activity" },
  validateSearch: (search: Record<string, unknown>): EventsSearch => ({
    type: text(search.type),
    action: text(search.action),
    ...pageSearch(search),
  }),
  component: EventsScreen,
});
