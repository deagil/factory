// What a list takes: filters, one sort, a cursor, a page size, whether to
// show archived records, and which refs to follow. listInputSchema(object)
// validates it; the generated `.list` query (P1.09) uses the same schema.

import { eq, gt, gte, inArray, lt, lte, ne } from "drizzle-orm";
import type { SQL } from "drizzle-orm";
import type { PgColumn } from "drizzle-orm/pg-core";
import { z } from "zod";

import type { AnyObjectDefinition } from "../define-object.ts";
import type { AnyField } from "../fields/field.ts";
import { filterSchema, maxInValues } from "../fields/filters.ts";
import type { Filterable } from "../fields/filters.ts";

/** The most records one page returns, and the default. */
export const maxPageSize = 200;
export const defaultPageSize = 50;

/** Newest first, unless a list asks for another order. */
export const defaultSort = "-createdAt";

const archivedModes = ["exclude", "include", "only"] as const;
export type ArchivedMode = (typeof archivedModes)[number];

const on = (
  value: z.ZodType,
  where: (column: PgColumn, v: never) => SQL
): Filterable["filters"][string] => ({
  value,
  where: (columns: Record<string, PgColumn>, v: unknown) =>
    where(columns[""] as PgColumn, v as never),
});

const idFilters = {
  eq: on(z.uuid(), (c, v: string) => eq(c, v)),
  ne: on(z.uuid(), (c, v: string) => ne(c, v)),
  in: on(z.array(z.uuid()).min(1).max(maxInValues), (c, v: string[]) =>
    inArray(c, v)
  ),
};

const instant = z.iso.datetime({ offset: true });
const timeFilters = {
  gt: on(instant, (c, v: string) => gt(c, new Date(v))),
  gte: on(instant, (c, v: string) => gte(c, new Date(v))),
  lt: on(instant, (c, v: string) => lt(c, new Date(v))),
  lte: on(instant, (c, v: string) => lte(c, new Date(v))),
};

/** Housekeeping columns a list can filter on, as if they were fields. */
export const housekeepingFilters: Record<string, Filterable> = {
  id: { kind: "id", filters: idFilters },
  createdBy: { kind: "id", filters: idFilters },
  updatedBy: { kind: "id", filters: idFilters },
  createdAt: { kind: "timestamp", filters: timeFilters },
  updatedAt: { kind: "timestamp", filters: timeFilters },
};

/** Housekeeping columns a list can sort on. Their values are timestamps. */
export const timestampSortKeys = ["createdAt", "updatedAt"] as const;

const sortableKinds = new Set(["text", "number", "money", "date", "boolean"]);

/** The keys an object's lists can sort on: some fields, and the timestamps. */
export const sortKeysOf = (object: AnyObjectDefinition): string[] => [
  ...Object.entries(object.fields as Record<string, AnyField>)
    .filter(([, field]) => sortableKinds.has(field.kind))
    .map(([key]) => key),
  ...timestampSortKeys,
];

/** The ref fields an object's lists can follow. */
export const refKeysOf = (object: AnyObjectDefinition): string[] =>
  Object.entries(object.fields as Record<string, AnyField>)
    .filter(([, field]) => field.kind === "ref")
    .map(([key]) => key);

/** `-value` sorts by value, descending. */
export const parseSort = (sort: string) =>
  sort.startsWith("-")
    ? { key: sort.slice(1), descending: true }
    : { key: sort, descending: false };

/** Where a page ended: the sort, and the last record's sort value and id. */
export interface Cursor {
  sort: string;
  value: unknown;
  id: string;
}

export const encodeCursor = (cursor: Cursor): string =>
  Buffer.from(
    JSON.stringify({ s: cursor.sort, v: cursor.value, id: cursor.id })
  ).toString("base64url");

const cursorShape = z.strictObject({
  s: z.string(),
  v: z.union([z.string(), z.number(), z.boolean(), z.null()]),
  id: z.uuid(),
});

/** The cursor in `text`, or undefined if it isn't one. */
export const decodeCursor = (text: string): Cursor | undefined => {
  try {
    const parsed = cursorShape.safeParse(
      JSON.parse(Buffer.from(text, "base64url").toString("utf-8"))
    );
    return parsed.success
      ? { sort: parsed.data.s, value: parsed.data.v, id: parsed.data.id }
      : undefined;
  } catch {
    return undefined;
  }
};

const schemas = new WeakMap<AnyObjectDefinition, z.ZodType>();

const buildListInputSchema = (object: AnyObjectDefinition) => {
  const fields = object.fields as Record<string, AnyField>;
  const filterShape: Record<string, z.ZodType> = {};
  for (const [key, filterable] of [
    ...Object.entries(housekeepingFilters),
    ...Object.entries(fields),
  ]) {
    filterShape[key] = filterSchema(filterable).optional();
  }
  const sortKeys = sortKeysOf(object);
  const refKeys = refKeysOf(object);
  const sorts = [...sortKeys, ...sortKeys.map((key) => `-${key}`)] as [
    string,
    ...string[],
  ];
  return z
    .strictObject({
      filter: z.strictObject(filterShape).optional(),
      sort: z.enum(sorts).optional(),
      cursor: z.string().optional(),
      limit: z.int().min(1).max(maxPageSize).optional(),
      archived: z.enum(archivedModes).optional(),
      expand:
        refKeys.length > 0
          ? z.array(z.enum(refKeys as [string, ...string[]])).optional()
          : z.array(z.never()).max(0).optional(),
    })
    .superRefine((input, context) => {
      if (input.cursor === undefined) {
        return;
      }
      const cursor = decodeCursor(input.cursor);
      if (!cursor) {
        context.addIssue({
          code: "custom",
          path: ["cursor"],
          message:
            "This isn't a cursor from this list. Start again without one.",
        });
      } else if (cursor.sort !== (input.sort ?? defaultSort)) {
        context.addIssue({
          code: "custom",
          path: ["cursor"],
          message: `This cursor is for the sort "${cursor.sort}". Use that sort, or start again without a cursor.`,
        });
      }
    });
};

/** What a list of `object`'s records takes. */
export interface ListInput {
  /** By field key (or `id`, `createdAt` and so on): an object of operators. */
  filter?: Record<string, Record<string, unknown>>;
  /** A sortable key; a leading `-` sorts descending. Defaults to `-createdAt`. */
  sort?: string;
  /** From the previous page's `nextCursor`. */
  cursor?: string;
  /** Records per page: 1 to 200, 50 by default. */
  limit?: number;
  /** Archived records are hidden unless this says otherwise. */
  archived?: ArchivedMode;
  /** Ref fields to follow, one level deep. */
  expand?: string[];
}

/** The schema for an object's list input, built once per object. */
export const listInputSchema = (
  object: AnyObjectDefinition
): z.ZodType<ListInput> => {
  let schema = schemas.get(object);
  if (!schema) {
    schema = buildListInputSchema(object);
    schemas.set(object, schema);
  }
  return schema as z.ZodType<ListInput>;
};
