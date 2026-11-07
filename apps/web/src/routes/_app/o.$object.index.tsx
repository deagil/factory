// The generated list screen: one for every object, built from
// system.describe and the object's `.list` query. Filters, sort and page
// are in the URL (P1.20).
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { Link, createFileRoute, useNavigate } from "@tanstack/react-router";
import { Button, buttonVariants } from "@workspace/ui/components/button";

import { FilterBar } from "../../components/filter-bar.tsx";
import { PageHeader } from "../../components/page-header.tsx";
import { describeSystem, runQuery } from "../../lib/api.ts";
import { plural } from "../../lib/nav.ts";
import {
  columnsOf,
  displayValue,
  expandable,
  findObject,
  isSortable,
  nextSort,
} from "../../lib/records.ts";
import type { Filter, ListPage } from "../../lib/records.ts";

interface ListSearch {
  sort?: string;
  /** Show archived records alongside the rest. */
  archived?: boolean;
  filter?: Filter;
  cursor?: string;
  /** Cursors of earlier pages, for "Previous". */
  back?: string[];
}

const pageSize = 25;

const ListScreen = () => {
  const { object: name } = Route.useParams();
  const search = Route.useSearch();
  const navigate = useNavigate({ from: Route.fullPath });
  const described = useQuery({
    queryKey: ["system.describe"],
    queryFn: describeSystem,
  });
  const object = findObject(described.data, name);
  const columns = object ? columnsOf(object) : [];

  const page = useQuery({
    queryKey: ["list", name, search],
    queryFn: () =>
      runQuery<ListPage>(`${name}.list`, {
        filter: search.filter,
        sort: search.sort,
        archived: search.archived ? "include" : undefined,
        cursor: search.cursor,
        limit: pageSize,
        expand: expandable(columns),
      }),
    enabled: object !== undefined,
    placeholderData: keepPreviousData,
  });

  // Any change but paging starts again from the first page.
  const update = (next: Partial<ListSearch>) =>
    navigate({
      search: (previous) => ({
        ...previous,
        cursor: undefined,
        back: undefined,
        ...next,
      }),
    });

  if (described.isPending) {
    return (
      <>
        <PageHeader title="Loading…" />
        <p className="text-sm text-muted-foreground">Loading…</p>
      </>
    );
  }
  if (!object) {
    return (
      <>
        <PageHeader title={name} />
        <p role="alert">There is nothing called {name} here.</p>
      </>
    );
  }

  const back = search.back ?? [];
  const canCreate = described.data?.actions.some(
    (action) => action.name === `${name}.create`
  );
  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        title={plural(object.label)}
        actions={
          canCreate ? (
            <Link
              to="/o/$object/new"
              params={{ object: name }}
              className={buttonVariants()}
            >
              New {object.label.toLowerCase()}
            </Link>
          ) : null
        }
      />
      <div className="flex flex-wrap items-start justify-between gap-3">
        <FilterBar
          fields={object.fields}
          filter={search.filter ?? {}}
          onChange={(filter) =>
            update({
              filter: Object.keys(filter).length > 0 ? filter : undefined,
            })
          }
        />
        <label className="flex items-center gap-2 py-1.5 text-sm text-muted-foreground">
          <input
            type="checkbox"
            checked={search.archived ?? false}
            onChange={(event) =>
              update({ archived: event.target.checked || undefined })
            }
          />
          Show archived
        </label>
      </div>
      {page.isError && (
        <p role="alert" className="text-sm text-destructive">
          {page.error.message}
        </p>
      )}
      <div className="overflow-x-auto rounded-2xl border">
        <table className="w-full text-left text-sm">
          <thead className="border-b bg-muted/50">
            <tr>
              {columns.map((field) => (
                <th
                  key={field.key}
                  scope="col"
                  className="px-3 py-2 font-medium"
                >
                  {isSortable(field) ? (
                    <button
                      type="button"
                      className="inline-flex items-center gap-1 hover:underline"
                      onClick={() =>
                        update({ sort: nextSort(search.sort, field.key) })
                      }
                    >
                      {field.label}
                      {search.sort === field.key && " ↑"}
                      {search.sort === `-${field.key}` && " ↓"}
                    </button>
                  ) : (
                    field.label
                  )}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {page.data?.records.map((record) => (
              <tr
                key={String(record.id)}
                className="border-b last:border-0 hover:bg-muted/30"
              >
                {columns.map((field, index) => (
                  <td key={field.key} className="px-3 py-2">
                    {index === 0 ? (
                      <Link
                        to="/o/$object/$id"
                        params={{ object: name, id: String(record.id) }}
                        className="font-medium hover:underline"
                      >
                        {displayValue(
                          field,
                          record,
                          page.data.related,
                          described.data
                        ) || "(blank)"}
                      </Link>
                    ) : null}
                    {index === 0 && record.archivedAt ? (
                      <span className="ml-2 rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground">
                        Archived
                      </span>
                    ) : null}
                    {index === 0
                      ? null
                      : displayValue(
                          field,
                          record,
                          page.data.related,
                          described.data
                        )}
                  </td>
                ))}
              </tr>
            ))}
            {page.data?.records.length === 0 && (
              <tr>
                <td
                  colSpan={columns.length}
                  className="px-3 py-6 text-center text-muted-foreground"
                >
                  No {object.label.toLowerCase()}s match.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      <div className="flex justify-end gap-2">
        <Button
          variant="outline"
          size="sm"
          disabled={back.length === 0}
          onClick={() =>
            navigate({
              search: (previous) => ({
                ...previous,
                cursor: back.at(-1) || undefined,
                back: back.length > 1 ? back.slice(0, -1) : undefined,
              }),
            })
          }
        >
          Previous
        </Button>
        <Button
          variant="outline"
          size="sm"
          disabled={!page.data?.nextCursor}
          onClick={() =>
            navigate({
              search: (previous) => ({
                ...previous,
                cursor: page.data?.nextCursor ?? undefined,
                back: [...back, search.cursor ?? ""],
              }),
            })
          }
        >
          Next
        </Button>
      </div>
    </div>
  );
};

export const Route = createFileRoute("/_app/o/$object/")({
  staticData: { section: "data" },
  validateSearch: (search: Record<string, unknown>): ListSearch => ({
    sort: typeof search.sort === "string" ? search.sort : undefined,
    archived: search.archived === true ? true : undefined,
    filter:
      search.filter && typeof search.filter === "object"
        ? (search.filter as Filter)
        : undefined,
    cursor: typeof search.cursor === "string" ? search.cursor : undefined,
    back: Array.isArray(search.back) ? (search.back as string[]) : undefined,
  }),
  component: ListScreen,
});
