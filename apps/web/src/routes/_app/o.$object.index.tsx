// The generated list screen: one for every object, built from
// system.describe and the object's `.list` query. Filters, sort and page
// are in the URL (P1.20).
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { Link, createFileRoute, useNavigate } from "@tanstack/react-router";
import { buttonVariants } from "@workspace/ui/components/button";

import { Pager } from "../../components/activity.tsx";
import { DataTable, tableHeadCell } from "../../components/data-table.tsx";
import { FilterBar } from "../../components/filter-bar.tsx";
import { OpenRow } from "../../components/open-row.tsx";
import { PageHeader } from "../../components/page-header.tsx";
import { WithAvatar } from "../../components/record-title.tsx";
import { describeSystem, objectApi } from "../../lib/api.ts";
import { plural } from "../../lib/nav.ts";
import {
  readableFields,
  columnsOf,
  displayValue,
  expandable,
  findObject,
  isSortable,
  leadingSrc,
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
      objectApi(name, object?.endpoints).list<ListPage>({
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

  const canCreate = described.data?.actions.some(
    (action) => action.name === `${name}_create`
  );
  return (
    <div className="flex min-h-0 flex-1 flex-col gap-4">
      <PageHeader
        title={plural(object.label)}
        trail={[{ label: "Objects", link: { to: "/data/objects" } }]}
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
      <DataTable
        fill
        toolbar={
          <FilterBar
            fields={readableFields(object)}
            filter={search.filter ?? {}}
            onChange={(filter) =>
              update({
                filter: Object.keys(filter).length > 0 ? filter : undefined,
              })
            }
            archived={search.archived === true}
            onArchivedChange={(next) =>
              update({ archived: next ? true : undefined })
            }
          />
        }
        error={page.isError ? page.error.message : undefined}
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
            {columns.map((field) => (
              <th key={field.key} scope="col" className={tableHeadCell}>
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
            <OpenRow
              key={String(record.id)}
              onOpen={() =>
                navigate({
                  to: "/o/$object/$id",
                  params: { object: name, id: String(record.id) },
                })
              }
            >
              {columns.map((field, index) => {
                const text = displayValue(
                  field,
                  record,
                  page.data.related,
                  described.data
                );
                const shown = (
                  <WithAvatar
                    src={leadingSrc(
                      field,
                      record,
                      page.data.related,
                      described.data,
                      object
                    )}
                  >
                    {text || (index === 0 ? "(blank)" : "")}
                  </WithAvatar>
                );
                return (
                  <td key={field.key} className="px-3 py-2">
                    {index === 0 ? (
                      <Link
                        to="/o/$object/$id"
                        params={{ object: name, id: String(record.id) }}
                        className="font-medium hover:underline"
                      >
                        {shown}
                      </Link>
                    ) : (
                      shown
                    )}
                    {index === 0 && record.archivedAt ? (
                      <span className="ml-2 rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground">
                        Archived
                      </span>
                    ) : null}
                  </td>
                );
              })}
            </OpenRow>
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
      </DataTable>
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
