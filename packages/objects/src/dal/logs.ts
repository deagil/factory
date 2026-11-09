// Reading the logs (P1b.02): runs (P2.12), `audit_log` and `event_log`,
// newest first, with who did each thing and who they did it for. They are
// read here, like records, so no raw SQL leaves packages/db (AGENTS.md rule
// 2). Who may read them is the queries' job, not this layer's.

import { jsonbHasKey } from "@workspace/db";
import type { Executor } from "@workspace/db";
import {
  actors,
  auditLog,
  eventLog,
  runs,
  runSteps,
  users,
} from "@workspace/db/schema";
import type { runStatuses, runStepKinds } from "@workspace/db/schema";
import { and, desc, eq, gte, like, lt, lte, or } from "drizzle-orm";
import type { AnyColumn, SQL } from "drizzle-orm";

import type { ActorSummary } from "./data-access.ts";
import { defaultPageSize, maxPageSize } from "./list-input.ts";

export type RunStatus = (typeof runStatuses)[number];

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

export interface RunFilter extends TimeRange {
  actorId?: string;
  /** The endpoint called, as `contact.update`. */
  endpoint?: string;
  /** An endpoint prefix, as `contact.` for every contact endpoint. */
  endpointPrefix?: string;
  status?: RunStatus;
  dryRun?: boolean;
  /** Only runs this actor performed or this user started. */
  involving?: { actorId: string; userId: string | null };
}

export interface RunEntry {
  id: string;
  endpoint: string;
  status: RunStatus;
  dryRun: boolean;
  at: string;
  finishedAt: string | null;
  actor: ActorSummary;
  /** The person at the start of the chain; null for integrations. */
  origin: UserSummary | null;
  error: unknown;
}

/** One step of a run: a `run_steps` row. */
export interface RunStepEntry {
  id: string;
  stepId: string;
  kind: (typeof runStepKinds)[number];
  name: string;
  segment: number;
  attempt: number;
  branch: string | null;
  input: unknown;
  output: unknown;
  error: unknown;
  at: string;
  finishedAt: string | null;
}

export interface ChangeEntry {
  id: string;
  at: string;
  object: string;
  recordId: string;
  /** The action that made it, in run `runId`'s step `stepId`. */
  action: string;
  runId: string;
  stepId: string;
  actor: ActorSummary;
  origin: UserSummary | null;
  before: Record<string, unknown>;
  after: Record<string, unknown>;
}

export interface EventEntry {
  id: string;
  type: string;
  at: string;
  runId: string | null;
  stepId: string | null;
  depth: number;
  dispatchedAt: string | null;
  origin: UserSummary | null;
  payload: unknown;
}

export interface RunDetail extends RunEntry {
  input: unknown;
  output: unknown;
  retryKey: string | null;
  configSha: string | null;
  parentRunId: string | null;
  steps: RunStepEntry[];
  changes: ChangeEntry[];
  events: EventEntry[];
}

export interface ChangeFilter extends TimeRange {
  object?: string;
  recordId?: string;
  /** Only changes to this field. */
  field?: string;
  actorId?: string;
  runId?: string;
}

export interface EventFilter extends TimeRange {
  type?: string;
  /** A type prefix, as `contact.` for every contact event. */
  typePrefix?: string;
  runId?: string;
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

const toRunEntry = ({
  startedAt,
  finishedAt,
  originId,
  originName,
  ...row
}: {
  id: string;
  endpoint: string;
  status: RunStatus;
  dryRun: boolean;
  startedAt: Date;
  finishedAt: Date | null;
  error: unknown;
  actor: ActorSummary;
  originId: string | null;
  originName: string | null;
}): RunEntry => ({
  ...row,
  at: iso(startedAt),
  finishedAt: isoOrNull(finishedAt),
  origin: originOf(originId, originName),
});

export const createLogReader = (executor: Executor) => {
  const runColumns = {
    id: runs.id,
    endpoint: runs.endpoint,
    status: runs.status,
    dryRun: runs.dryRun,
    startedAt: runs.startedAt,
    finishedAt: runs.finishedAt,
    error: runs.error,
    actor: { id: actors.id, name: actors.name, kind: actors.kind },
    originId: runs.originUserId,
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
        action: runSteps.name,
        runId: runs.id,
        stepId: runSteps.id,
        actor: { id: actors.id, name: actors.name, kind: actors.kind },
        originId: runs.originUserId,
        originName: users.name,
        before: auditLog.before,
        after: auditLog.after,
      })
      .from(auditLog)
      // Changes made before runs (P2.12) have no run, and aren't shown.
      .innerJoin(runSteps, eq(auditLog.stepId, runSteps.id))
      .innerJoin(runs, eq(auditLog.runId, runs.id))
      .innerJoin(actors, eq(auditLog.actorId, actors.id))
      .leftJoin(users, eq(runs.originUserId, users.id))
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
        runId: eventLog.runId,
        stepId: eventLog.stepId,
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

  /** Runs, newest first. */
  const runList = async (
    filter: RunFilter = {},
    page: LogPage = {}
  ): Promise<LogResult<RunEntry>> => {
    const size = sizeOf(page.limit);
    const rows = await executor
      .select(runColumns)
      .from(runs)
      .innerJoin(actors, eq(runs.actorId, actors.id))
      .leftJoin(users, eq(runs.originUserId, users.id))
      .where(
        and(
          filter.actorId ? eq(runs.actorId, filter.actorId) : undefined,
          filter.endpoint ? eq(runs.endpoint, filter.endpoint) : undefined,
          filter.endpointPrefix
            ? like(runs.endpoint, prefixPattern(filter.endpointPrefix))
            : undefined,
          filter.status ? eq(runs.status, filter.status) : undefined,
          filter.dryRun === undefined
            ? undefined
            : eq(runs.dryRun, filter.dryRun),
          filter.involving
            ? or(
                eq(runs.actorId, filter.involving.actorId),
                filter.involving.userId
                  ? eq(runs.originUserId, filter.involving.userId)
                  : undefined
              )
            : undefined,
          ...within(runs.startedAt, filter),
          before(runs.startedAt, runs.id, decode(page.cursor))
        )
      )
      .orderBy(desc(runs.startedAt), desc(runs.id))
      .limit(size + 1);
    return paged(rows.map(toRunEntry), size);
  };

  /** One run with its steps and everything it wrote, or null. */
  const runGet = async (id: string): Promise<RunDetail | null> => {
    const [row] = await executor
      .select({
        ...runColumns,
        input: runs.input,
        output: runs.output,
        retryKey: runs.retryKey,
        configSha: runs.configSha,
        parentRunId: runs.parentRunId,
      })
      .from(runs)
      .innerJoin(actors, eq(runs.actorId, actors.id))
      .leftJoin(users, eq(runs.originUserId, users.id))
      .where(eq(runs.id, id));
    if (!row) {
      return null;
    }
    const { input, output, retryKey, configSha, parentRunId, ...entry } = row;
    const steps = await executor
      .select()
      .from(runSteps)
      .where(eq(runSteps.runId, id))
      .orderBy(runSteps.startedAt, runSteps.id);
    return {
      ...toRunEntry(entry),
      input,
      output,
      retryKey,
      configSha,
      parentRunId,
      steps: steps.map((step) => ({
        id: step.id,
        stepId: step.stepId,
        kind: step.kind,
        name: step.name,
        segment: step.segment,
        attempt: step.attempt,
        branch: step.branch,
        input: step.input,
        output: step.output,
        error: step.error,
        at: iso(step.startedAt),
        finishedAt: isoOrNull(step.finishedAt),
      })),
      changes: await changesWhere(eq(auditLog.runId, id), maxPageSize),
      events: await eventsWhere(eq(eventLog.runId, id), maxPageSize),
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
        filter.runId ? eq(auditLog.runId, filter.runId) : undefined,
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
        filter.runId ? eq(eventLog.runId, filter.runId) : undefined,
        ...within(eventLog.createdAt, filter),
        before(eventLog.createdAt, eventLog.id, decode(page.cursor))
      ),
      size + 1
    );
    return paged(rows, size);
  };

  return { runList, runGet, changes, events };
};
