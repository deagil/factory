// The data access layer: the only way to read records (AGENTS.md rule 2).
// It hides archived records unless asked, applies the read permission hook,
// pages with cursors and follows refs one level deep. See
// docs/SYSTEM_DESIGN.md section 4.1 and decision 0017.

import { ascNullsLast, descNullsLast } from "@workspace/db";
import type { Executor } from "@workspace/db";
import { actionLog, actors, auditLog, users } from "@workspace/db/schema";
import {
  and,
  asc,
  desc,
  eq,
  gt,
  inArray,
  isNotNull,
  isNull,
  lt,
  or,
} from "drizzle-orm";
import type { SQL } from "drizzle-orm";
import type { PgColumn, PgTable } from "drizzle-orm/pg-core";
import type { z } from "zod";

import type { AnyObjectDefinition } from "../define-object.ts";
import type { AnyField } from "../fields/field.ts";
import { filterWhere } from "../fields/filters.ts";
import type { Filterable } from "../fields/filters.ts";
import { getObject } from "../registry.ts";
import { createIdentityReader } from "./identity.ts";
import {
  decodeCursor,
  defaultPageSize,
  defaultSort,
  encodeCursor,
  housekeepingFilters,
  listInputSchema,
  parseSort,
  timestampSortKeys,
} from "./list-input.ts";
import type { ArchivedMode, ListInput } from "./list-input.ts";
import { createLogReader } from "./logs.ts";

/**
 * Which of an object's records the reader may see. Phase 1 has only the
 * `all` scope; `none` means the reader can't read the object at all. Later
 * scopes add a condition here.
 */
export type ReadAccess = "all" | "none";

export interface DataAccessOptions {
  /** The database, or the transaction an action runs in. */
  executor: Executor;
  /** The permission hook: what the reader may see of each object. */
  canRead: (object: AnyObjectDefinition) => ReadAccess;
}

/** A record of `TObject`, as reads return it. */
export type RecordOf<TObject extends AnyObjectDefinition> = z.output<
  TObject["schemas"]["record"]
>;

/** An actor, as a followed `ref("actor")` shows it. */
export interface ActorSummary {
  id: string;
  name: string;
  kind: string;
}

/**
 * Records that followed refs point at: by ref field, then by id. A record
 * the reader can't see is left out.
 */
export type Related = Record<string, Record<string, unknown>>;

export interface ListResult<TRecord> {
  records: TRecord[];
  /** Pass as `cursor` for the next page; null on the last page. */
  nextCursor: string | null;
  related: Related;
}

/** One change to a record: one `audit_log` row (decision 0018). */
export interface HistoryEntry {
  id: string;
  /** When the change was made, as an ISO timestamp. */
  at: string;
  /** The action that made it, and its `action_log` id. */
  action: string;
  actionId: string;
  /** Who made it. */
  actor: ActorSummary;
  /** The user an agent or workflow acted for; null for staff. */
  onBehalfOf: { id: string; name: string } | null;
  /** The changed fields only, by key. A create has an empty `before`. */
  before: Record<string, unknown>;
  after: Record<string, unknown>;
}

export interface GetOptions {
  /** `include` returns the record even if it's archived. */
  archived?: Exclude<ArchivedMode, "only">;
  expand?: string[];
}

export interface GetResult<TRecord> {
  record: TRecord;
  related: Related;
}

const columnOf = (table: PgTable, key: string): PgColumn => {
  const column = (table as unknown as Record<string, PgColumn | undefined>)[
    key
  ];
  if (!column) {
    throw new Error(`The table has no column for "${key}"`);
  }
  return column;
};

const archivedCondition = (
  table: PgTable,
  mode: ArchivedMode
): SQL | undefined => {
  const archivedAt = columnOf(table, "archivedAt");
  if (mode === "exclude") {
    return isNull(archivedAt);
  }
  return mode === "only" ? isNotNull(archivedAt) : undefined;
};

const filterConditions = (
  object: AnyObjectDefinition,
  filter: ListInput["filter"]
): SQL[] =>
  Object.entries(filter ?? {}).flatMap(([key, operators]) => {
    if (operators === undefined) {
      return [];
    }
    const field = (object.fields as Record<string, AnyField>)[key];
    const filterable: Filterable | undefined =
      field ?? housekeepingFilters[key];
    if (!filterable) {
      throw new Error(`${object.name} can't be filtered on "${key}"`);
    }
    const columns = field
      ? object.columnsOf(key)
      : { "": columnOf(object.table, key) };
    return [filterWhere(filterable, columns, operators)];
  });

/** Rows after the cursor, in the sort's order with empty values last. */
const afterCursor = (
  column: PgColumn,
  id: PgColumn,
  descending: boolean,
  value: unknown,
  lastId: string
): SQL => {
  const beyond = descending ? lt : gt;
  if (value === null) {
    return and(isNull(column), beyond(id, lastId)) as SQL;
  }
  return or(
    beyond(column, value),
    and(eq(column, value), beyond(id, lastId)),
    isNull(column)
  ) as SQL;
};

const isTimestamp = (key: string) =>
  (timestampSortKeys as readonly string[]).includes(key);

/** A sort value as it goes into a cursor: JSON-safe. */
const cursorValue = (value: unknown) =>
  value instanceof Date ? value.toISOString() : (value ?? null);

export const createDataAccess = ({ executor, canRead }: DataAccessOptions) => {
  const selectFrom = (table: PgTable) =>
    executor.select().from(table as never) as unknown as {
      where: (condition: SQL | undefined) => {
        orderBy: (...order: SQL[]) => {
          limit: (n: number) => Promise<Record<string, unknown>[]>;
        };
      } & Promise<Record<string, unknown>[]>;
    };

  /** The records `ids` point at in `target`, if the reader may see them. */
  const recordsById = async (
    target: string,
    ids: string[]
  ): Promise<Record<string, unknown>> => {
    if (target === "actor") {
      const rows = await executor
        .select({ id: actors.id, name: actors.name, kind: actors.kind })
        .from(actors)
        .where(inArray(actors.id, ids));
      return Object.fromEntries(
        rows.map((row): [string, ActorSummary] => [row.id, row])
      );
    }
    const object = getObject(target);
    if (!object || canRead(object) === "none") {
      return {};
    }
    // A ref to an archived record still shows it.
    const rows = await selectFrom(object.table).where(
      inArray(columnOf(object.table, "id"), ids)
    );
    return Object.fromEntries(
      rows.map((row) => [row.id as string, object.fromRow(row)])
    );
  };

  /** Follows `expand`'s refs from `records`, one level deep. */
  const follow = async (
    object: AnyObjectDefinition,
    records: Record<string, unknown>[],
    expand: string[] | undefined
  ): Promise<Related> => {
    const entries = [...new Set(expand)].map(async (key) => {
      const field = (object.fields as Record<string, AnyField>)[key] as
        | (AnyField & { target?: string })
        | undefined;
      if (field?.kind !== "ref" || !field.target) {
        throw new Error(
          `${object.name}.${key} isn't a ref, so it can't be followed`
        );
      }
      const ids = [
        ...new Set(
          records
            .map((record) => record[key])
            .filter((id): id is string => typeof id === "string")
        ),
      ];
      const found = ids.length > 0 ? await recordsById(field.target, ids) : {};
      return [key, found] as const;
    });
    return Object.fromEntries(await Promise.all(entries));
  };

  /** One page of `object`'s records. */
  const list = async <TObject extends AnyObjectDefinition>(
    object: TObject,
    input: ListInput = {}
  ): Promise<ListResult<RecordOf<TObject>>> => {
    const parsed = listInputSchema(object).parse(input);
    if (canRead(object) === "none") {
      return { records: [], nextCursor: null, related: {} };
    }
    const { table } = object;
    const sort = parsed.sort ?? defaultSort;
    const { key, descending } = parseSort(sort);
    const sortColumn = columnOf(table, key);
    const id = columnOf(table, "id");
    const limit = parsed.limit ?? defaultPageSize;

    const conditions = [
      archivedCondition(table, parsed.archived ?? "exclude"),
      ...filterConditions(object, parsed.filter),
    ];
    const cursor = parsed.cursor ? decodeCursor(parsed.cursor) : undefined;
    if (cursor) {
      const value =
        isTimestamp(key) && typeof cursor.value === "string"
          ? new Date(cursor.value)
          : cursor.value;
      conditions.push(
        afterCursor(sortColumn, id, descending, value, cursor.id)
      );
    }

    const rows = await selectFrom(table)
      .where(and(...conditions))
      .orderBy(
        descending ? descNullsLast(sortColumn) : ascNullsLast(sortColumn),
        descending ? desc(id) : asc(id)
      )
      .limit(limit + 1);

    const page = rows.slice(0, limit);
    const last = page.at(-1);
    const nextCursor =
      rows.length > limit && last
        ? encodeCursor({
            sort,
            value: cursorValue(last[key]),
            id: last.id as string,
          })
        : null;
    const records = page.map((row) => object.fromRow(row));
    return {
      records: records as RecordOf<TObject>[],
      nextCursor,
      related: await follow(object, records, parsed.expand),
    };
  };

  /** One record by id, or null if there isn't one the reader may see. */
  const get = async <TObject extends AnyObjectDefinition>(
    object: TObject,
    recordId: string,
    options: GetOptions = {}
  ): Promise<GetResult<RecordOf<TObject>> | null> => {
    if (canRead(object) === "none") {
      return null;
    }
    const { table } = object;
    const [row] = await selectFrom(table).where(
      and(
        eq(columnOf(table, "id"), recordId),
        archivedCondition(table, options.archived ?? "exclude")
      )
    );
    if (!row) {
      return null;
    }
    const record = object.fromRow(row);
    return {
      record: record as RecordOf<TObject>,
      related: await follow(object, [record], options.expand),
    };
  };

  /**
   * Every change to one record, newest first, with the action and actor
   * behind it. Empty if the reader can't read the object.
   */
  const history = async (
    object: AnyObjectDefinition,
    recordId: string
  ): Promise<HistoryEntry[]> => {
    if (canRead(object) === "none") {
      return [];
    }
    const rows = await executor
      .select({
        id: auditLog.id,
        at: auditLog.at,
        action: actionLog.name,
        actionId: auditLog.actionId,
        actor: { id: actors.id, name: actors.name, kind: actors.kind },
        originUserId: actionLog.originUserId,
        originUserName: users.name,
        before: auditLog.before,
        after: auditLog.after,
      })
      .from(auditLog)
      .innerJoin(actionLog, eq(auditLog.actionId, actionLog.id))
      .innerJoin(actors, eq(auditLog.actorId, actors.id))
      .leftJoin(users, eq(actionLog.originUserId, users.id))
      .where(
        and(eq(auditLog.object, object.name), eq(auditLog.recordId, recordId))
      )
      .orderBy(desc(auditLog.at), desc(auditLog.id));
    return rows.map(({ originUserId, originUserName, at, ...row }) => ({
      ...row,
      at: at.toISOString(),
      onBehalfOf:
        originUserId && row.actor.kind !== "staff"
          ? { id: originUserId, name: originUserName ?? "" }
          : null,
    }));
  };

  // The logs and identities aren't records of an object, so the read hook
  // doesn't apply; the queries that read them check their own permissions.
  return {
    get,
    history,
    list,
    ...createLogReader(executor),
    ...createIdentityReader(executor),
  };
};

/** A data access layer, as actions get it through `ctx.dal`. */
export type DataAccess = ReturnType<typeof createDataAccess>;
