// Automation → Events: the event types the caller's actions can emit.
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
import { describeSystem } from "../../lib/api.ts";

interface EventsSearch {
  q?: string;
}

const EventsScreen = () => {
  const search = Route.useSearch();
  const navigate = useNavigate({ from: Route.fullPath });
  const described = useQuery({
    queryKey: ["system.describe"],
    queryFn: describeSystem,
  });
  const q = search.q?.toLowerCase() ?? "";
  const events = (described.data?.events ?? [])
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
      <ErrorText error={described.error} />
      {described.isSuccess && events.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          {q === "" ? "No events you can see." : "No events match."}
        </p>
      ) : null}
      {events.length > 0 ? (
        <ul className="flex flex-col gap-2">
          {events.map((event) => (
            <li key={event.type} className="rounded-2xl border p-3">
              <p className="font-mono text-sm font-medium">{event.type}</p>
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
