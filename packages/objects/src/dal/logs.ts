// Reading the logs: `action_log`, `audit_log` and `event_log`,
// newest first, with who did each thing and who they did it for. They are
// read here, like records, so no raw SQL leaves packages/db (AGENTS.md rule
// 2). Who may read them is the queries' job, not this layer's.

import { jsonbHasKey } from "@workspace/db";
import type { Executor } from "@workspace/db";
import {
  actionLog,
  actors,
  auditLog,
  eventLog,
  users,
} from "@workspace/db/schema";
import type { actionStatuses } from "@workspace/db/schema";
import { and, desc, eq, gte, like, lt, lte, or } from "drizzle-orm";
import type { AnyColumn, SQL } from "drizzle-orm";

import type { ActorSummary } from "./data-access.ts";
import { defaultPageSize, maxPageSize } from "./list-input.ts";

export type ActionStatus = (typeof actionStatuses)[number];

/** A person, as the logs name them. */
export interface UserSummary {
  id: string;
  name: string;
}

export interface LogPage {
  /** The `nextCursor` of the page before. */
  cursor?: string;
  /** At most 200; 50 by default. */
  limit?: number;
}

export interface LogResult<TEntry> {
  entries: TEntry[];
  /** Pass as `cursor` for the next page; null on the last page. */
  nextCursor: string | null;
}

interface TimeRange {
  /** ISO timestamps; both ends included. */
  since?: string;
  until?: string;
}

export interface ActionLogFilter extends TimeRange {
  actorId?: string;
  /** The action's name, as `contact.update`. */
  name?: string;
  /** A name prefix, as `contact.` for every contact action. */
  namePrefix?: string;
  status?: ActionStatus;
  dryRun?: boolean;
  /** Only actions this actor performed or this user started. */
  involving?: { actorId: string; userId: string | null };
}

export interface ActionLogEntry {
  id: string;
  name: string;
  status: ActionStatus;
  dryRun: boolean;
  at: string;
  completedAt: string | null;
  actor: ActorSummary;
  /** The person at the start of the chain; null for integrations. */
  origin: UserSummary | null;
  error: unknown;
}

export interface ChangeEntry {
  id: string;
  at: string;
  object: string;
  recordId: string;
  action: string;
  actionId: string;
  actor: ActorSummary;
  origin: UserSummary | null;
  before: Record<string, unknown>;
  after: Record<string, unknown>;
}

export interface EventEntry {
  id: string;
  type: string;
  at: string;
  actionId: string;
  depth: number;
  dispatchedAt: string | null;
  origin: UserSummary | null;
  payload: unknown;
}

export interface ActionLogDetail extends ActionLogEntry {
  input: unknown;
  result: unknown;
  retryKey: string | null;
  configSha: string | null;
  runId: string | null;
  changes: ChangeEntry[];
  events: EventEntry[];
}

export interface ChangeFilter extends TimeRange {
  object?: string;
  recordId?: string;
  /** Only changes to this field. */
  field?: string;
  actorId?: string;
  actionId?: string;
}

export interface EventFilter extends TimeRange {
  type?: string;
  /** A type prefix, as `contact.` for every contact event. */
  typePrefix?: string;
  actionId?: string;
}

interface Position {
  at: string;
  id: string;
}

const encode = (position: Position) =>
  Buffer.from(JSON.stringify(position)).toString("base64url");

export const decode = (cursor: string | undefined): Position | undefined => {
  if (!cursor) {
    return;
  }
  try {
    const value = JSON.parse(
      Buffer.from(cursor, "base64url").toString("utf-8")
    ) as Partial<Position>;
    if (typeof value.at === "string" && typeof value.id === "string") {
      return { at: value.at, id: value.id };
    }
  } catch {
    // An unreadable cursor starts from the beginning.
  }
};

export const sizeOf = (limit: number | undefined) =>
  Math.min(Math.max(limit ?? defaultPageSize, 1), maxPageSize);

/** Newer than nothing, older than the cursor: (at, id) descending. */
export const before = (
  at: AnyColumn,
  id: AnyColumn,
  position: Position | undefined
): SQL | undefined => {
  if (!position) {
    return;
  }
  const when = new Date(position.at);
  return or(lt(at, when), and(eq(at, when), lt(id, position.id)));
};

const within = (at: AnyColumn, range: TimeRange): (SQL | undefined)[] => [
  range.since ? gte(at, new Date(range.since)) : undefined,
  range.until ? lte(at, new Date(range.until)) : undefined,
];

const prefixPattern = (prefix: string) =>
  `${prefix.replaceAll(/[\\%_]/gu, String.raw`\$&`)}%`;

/** Takes one more than a page, to know whether there's another. */
export const paged = <TEntry extends { at: string; id: string }>(
  rows: TEntry[],
  size: number
): LogResult<TEntry> => {
  const entries = rows.slice(0, size);
  const last = entries.at(-1);
  return {
    entries,
    nextCursor:
      rows.length > size && last ? encode({ at: last.at, id: last.id }) : null,
  };
};

export const iso = (date: Date) => date.toISOString();
export const isoOrNull = (date: Date | null) =>
  date ? date.toISOString() : null;

const originOf = (id: string | null, name: string | null) =>
  id ? { id, name: name ?? "" } : null;

const toActionEntry = ({
  createdAt,
  completedAt,
  originId,
  originName,
  ...row
}: {
  id: string;
  name: string;
  status: ActionStatus;
  dryRun: boolean;
  createdAt: Date;
  completedAt: Date | null;
  error: unknown;
  actor: ActorSummary;
  originId: string | null;
  originName: string | null;
}): ActionLogEntry => ({
  ...row,
  at: iso(createdAt),
  completedAt: isoOrNull(completedAt),
  origin: originOf(originId, originName),
});

export const createLogReader = (executor: Executor) => {
  const actionColumns = {
    id: actionLog.id,
    name: actionLog.name,
    status: actionLog.status,
    dryRun: actionLog.dryRun,
    createdAt: actionLog.createdAt,
    completedAt: actionLog.completedAt,
    error: actionLog.error,
    actor: { id: actors.id, name: actors.name, kind: actors.kind },
    originId: actionLog.originUserId,
    originName: users.name,
  };

  const changesWhere = async (
    where: SQL | undefined,
    size: number
  ): Promise<ChangeEntry[]> => {
    const rows = await executor
      .select({
        id: auditLog.id,
        at: auditLog.at,
        object: auditLog.object,
        recordId: auditLog.recordId,
        action: actionLog.name,
        actionId: auditLog.actionId,
        actor: { id: actors.id, name: actors.name, kind: actors.kind },
        originId: actionLog.originUserId,
        originName: users.name,
        before: auditLog.before,
        after: auditLog.after,
      })
      .from(auditLog)
      .innerJoin(actionLog, eq(auditLog.actionId, actionLog.id))
      .innerJoin(actors, eq(auditLog.actorId, actors.id))
      .leftJoin(users, eq(actionLog.originUserId, users.id))
      .where(where)
      .orderBy(desc(auditLog.at), desc(auditLog.id))
      .limit(size);
    return rows.map(({ at, originId, originName, ...row }) => ({
      ...row,
      at: iso(at),
      origin: originOf(originId, originName),
    }));
  };

  const eventsWhere = async (
    where: SQL | undefined,
    size: number
  ): Promise<EventEntry[]> => {
    const rows = await executor
      .select({
        id: eventLog.id,
        type: eventLog.type,
        createdAt: eventLog.createdAt,
        actionId: eventLog.actionId,
        depth: eventLog.depth,
        dispatchedAt: eventLog.dispatchedAt,
        originId: eventLog.originUserId,
        originName: users.name,
        payload: eventLog.payload,
      })
      .from(eventLog)
      .leftJoin(users, eq(eventLog.originUserId, users.id))
      .where(where)
      .orderBy(desc(eventLog.createdAt), desc(eventLog.id))
      .limit(size);
    return rows.map(
      ({ createdAt, dispatchedAt, originId, originName, ...row }) => ({
        ...row,
        at: iso(createdAt),
        dispatchedAt: isoOrNull(dispatchedAt),
        origin: originOf(originId, originName),
      })
    );
  };

  /** `action_log`, newest first. */
  const actions = async (
    filter: ActionLogFilter = {},
    page: LogPage = {}
  ): Promise<LogResult<ActionLogEntry>> => {
    const size = sizeOf(page.limit);
    const rows = await executor
      .select(actionColumns)
      .from(actionLog)
      .innerJoin(actors, eq(actionLog.actorId, actors.id))
      .leftJoin(users, eq(actionLog.originUserId, users.id))
      .where(
        and(
          filter.actorId ? eq(actionLog.actorId, filter.actorId) : undefined,
          filter.name ? eq(actionLog.name, filter.name) : undefined,
          filter.namePrefix
            ? like(actionLog.name, prefixPattern(filter.namePrefix))
            : undefined,
          filter.status ? eq(actionLog.status, filter.status) : undefined,
          filter.dryRun === undefined
            ? undefined
            : eq(actionLog.dryRun, filter.dryRun),
          filter.involving
            ? or(
                eq(actionLog.actorId, filter.involving.actorId),
                filter.involving.userId
                  ? eq(actionLog.originUserId, filter.involving.userId)
                  : undefined
              )
            : undefined,
          ...within(actionLog.createdAt, filter),
          before(actionLog.createdAt, actionLog.id, decode(page.cursor))
        )
      )
      .orderBy(desc(actionLog.createdAt), desc(actionLog.id))
      .limit(size + 1);
    return paged(rows.map(toActionEntry), size);
  };

  /** One `action_log` row with everything it wrote, or null. */
  const action = async (id: string): Promise<ActionLogDetail | null> => {
    const [row] = await executor
      .select({
        ...actionColumns,
        input: actionLog.input,
        result: actionLog.result,
        retryKey: actionLog.retryKey,
        configSha: actionLog.configSha,
        runId: actionLog.runId,
      })
      .from(actionLog)
      .innerJoin(actors, eq(actionLog.actorId, actors.id))
      .leftJoin(users, eq(actionLog.originUserId, users.id))
      .where(eq(actionLog.id, id));
    if (!row) {
      return null;
    }
    const { input, result, retryKey, configSha, runId, ...entry } = row;
    return {
      ...toActionEntry(entry),
      input,
      result,
      retryKey,
      configSha,
      runId,
      changes: await changesWhere(eq(auditLog.actionId, id), maxPageSize),
      events: await eventsWhere(eq(eventLog.actionId, id), maxPageSize),
    };
  };

  /** `audit_log` across records, newest first. */
  const changes = async (
    filter: ChangeFilter = {},
    page: LogPage = {}
  ): Promise<LogResult<ChangeEntry>> => {
    const size = sizeOf(page.limit);
    const rows = await changesWhere(
      and(
        filter.object ? eq(auditLog.object, filter.object) : undefined,
        filter.recordId ? eq(auditLog.recordId, filter.recordId) : undefined,
        filter.field ? jsonbHasKey(auditLog.after, filter.field) : undefined,
        filter.actorId ? eq(auditLog.actorId, filter.actorId) : undefined,
        filter.actionId ? eq(auditLog.actionId, filter.actionId) : undefined,
        ...within(auditLog.at, filter),
        before(auditLog.at, auditLog.id, decode(page.cursor))
      ),
      size + 1
    );
    return paged(rows, size);
  };

  /** `event_log`, newest first. */
  const events = async (
    filter: EventFilter = {},
    page: LogPage = {}
  ): Promise<LogResult<EventEntry>> => {
    const size = sizeOf(page.limit);
    const rows = await eventsWhere(
      and(
        filter.type ? eq(eventLog.type, filter.type) : undefined,
        filter.typePrefix
          ? like(eventLog.type, prefixPattern(filter.typePrefix))
          : undefined,
        filter.actionId ? eq(eventLog.actionId, filter.actionId) : undefined,
        ...within(eventLog.createdAt, filter),
        before(eventLog.createdAt, eventLog.id, decode(page.cursor))
      ),
      size + 1
    );
    return paged(rows, size);
  };

  return { actions, action, changes, events };
};
