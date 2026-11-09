// Settings → Reference: everything system.describe says the
// caller can use (objects and fields, actions, queries and events), each
// with its schema. Search is in the URL.
import { useQuery } from "@tanstack/react-query";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import type { ReactNode } from "react";

import {
  ErrorText,
  Json,
  TextFilter,
  text,
} from "../../components/activity.tsx";
import { PageHeader } from "../../components/page-header.tsx";
import { describeSystem } from "../../lib/api.ts";

interface ReferenceSearch {
  q?: string;
}

const Schema = ({ label, value }: { label: string; value: unknown }) => (
  <details className="text-sm">
    <summary className="cursor-pointer text-muted-foreground">{label}</summary>
    <div className="mt-2">
      <Json value={value} />
    </div>
  </details>
);

const Entry = ({
  id,
  name,
  description,
  children,
}: {
  id: string;
  name: string;
  description?: string | null;
  children?: ReactNode;
}) => (
  <li id={id} className="flex flex-col gap-2 rounded-2xl border p-3">
    <div>
      <p className="font-mono text-sm font-medium">{name}</p>
      {description ? (
        <p className="text-sm text-muted-foreground">{description}</p>
      ) : null}
    </div>
    {children}
  </li>
);

const Group = ({
  title,
  count,
  children,
}: {
  title: string;
  count: number;
  children: ReactNode;
}) =>
  count === 0 ? null : (
    <section className="flex flex-col gap-2">
      <h2 className="font-medium">
        {title} <span className="text-muted-foreground">({count})</span>
      </h2>
      <ul className="flex flex-col gap-2">{children}</ul>
    </section>
  );

const ReferenceScreen = () => {
  const search = Route.useSearch();
  const navigate = useNavigate({ from: Route.fullPath });
  const described = useQuery({
    queryKey: ["system.describe"],
    queryFn: describeSystem,
  });
  const q = search.q?.toLowerCase() ?? "";
  const matches = (...texts: (string | null | undefined)[]) =>
    q === "" || texts.some((each) => each?.toLowerCase().includes(q));
  const d = described.data;
  const objects = (d?.objects ?? []).filter((object) =>
    matches(object.name, object.label, object.description)
  );
  const actions = (d?.actions ?? []).filter((action) =>
    matches(action.name, action.description, ...action.emits)
  );
  const queries = (d?.queries ?? []).filter((query) =>
    matches(query.name, query.description)
  );
  const events = (d?.events ?? []).filter((event) => matches(event.type));

  return (
    <div className="flex max-w-4xl flex-col gap-6">
      <PageHeader title="Reference" />
      <p className="text-sm text-muted-foreground">
        What you can use in this system, from <code>system.describe</code>.
        Someone with other roles sees a different list.
      </p>
      <TextFilter
        key={search.q ?? ""}
        label="Find"
        placeholder="contact.moveToOrganisation"
        value={search.q}
        onChange={(next) => navigate({ search: { q: next } })}
      />
      <ErrorText error={described.error} />
      <Group title="Objects" count={objects.length}>
        {objects.map((object) => (
          <Entry
            key={object.name}
            id={`object-${object.name}`}
            name={object.name}
            description={object.description ?? object.label}
          >
            <div className="overflow-x-auto rounded-xl border">
              <table className="w-full text-left text-sm">
                <thead className="border-b bg-muted/50">
                  <tr>
                    <th className="px-3 py-1.5 font-medium">Field</th>
                    <th className="px-3 py-1.5 font-medium">Label</th>
                    <th className="px-3 py-1.5 font-medium">Type</th>
                    <th className="px-3 py-1.5 font-medium">Notes</th>
                  </tr>
                </thead>
                <tbody>
                  {object.fields.map((field) => (
                    <tr key={field.key} className="border-b last:border-0">
                      <td className="px-3 py-1.5 font-mono text-xs">
                        {field.key}
                      </td>
                      <td className="px-3 py-1.5">{field.label}</td>
                      <td className="px-3 py-1.5">
                        {field.type}
                        {field.target ? ` → ${field.target}` : ""}
                      </td>
                      <td className="px-3 py-1.5 text-muted-foreground">
                        {[
                          field.required && "required",
                          field.readOnly && "read-only",
                        ]
                          .filter(Boolean)
                          .join(", ")}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Entry>
        ))}
      </Group>
      <Group title="Actions" count={actions.length}>
        {actions.map((action) => (
          <Entry
            key={action.name}
            id={`action-${action.name}`}
            name={action.name}
            description={action.description}
          >
            {action.emits.length > 0 && (
              <p className="text-sm">
                <span className="text-muted-foreground">Emits </span>
                <span className="font-mono text-xs">
                  {action.emits.join(", ")}
                </span>
              </p>
            )}
            <Schema label="Input" value={action.input} />
            <Schema label="Output" value={action.output} />
          </Entry>
        ))}
      </Group>
      <Group title="Queries" count={queries.length}>
        {queries.map((query) => (
          <Entry
            key={query.name}
            id={`query-${query.name}`}
            name={query.name}
            description={query.description}
          >
            <Schema label="Input" value={query.input} />
            <Schema label="Output" value={query.output} />
          </Entry>
        ))}
      </Group>
      <Group title="Events" count={events.length}>
        {events.map((event) => (
          <Entry key={event.type} id={`event-${event.type}`} name={event.type}>
            <Schema label="Payload" value={event.payload} />
          </Entry>
        ))}
      </Group>
    </div>
  );
};

export const Route = createFileRoute("/_app/settings/reference")({
  staticData: { section: "settings" },
  validateSearch: (search: Record<string, unknown>): ReferenceSearch => ({
    q: text(search.q),
  }),
  component: ReferenceScreen,
});
