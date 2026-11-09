// Reading actors, their roles and their API keys, for the Access
// screens and pickers. Key hashes never leave the database. Who may read
// them is the queries' job, not this layer's.

import type { Executor } from "@workspace/db";
import { actorRoles, actors, apiKeys, users } from "@workspace/db/schema";
import type {
  actorKinds,
  actorStatuses,
  userStatuses,
} from "@workspace/db/schema";
import { and, asc, desc, eq, inArray } from "drizzle-orm";

import { before, decode, iso, isoOrNull, paged, sizeOf } from "./logs.ts";
import type { LogPage, LogResult } from "./logs.ts";

export type ActorKind = (typeof actorKinds)[number];
export type ActorStatus = (typeof actorStatuses)[number];
export type UserStatus = (typeof userStatuses)[number];

export interface ActorFilter {
  kind?: ActorKind;
  status?: ActorStatus;
  /** Only this user's actors: their staff actor and their agents. */
  userId?: string;
}

export interface ActorEntry {
  id: string;
  kind: ActorKind;
  name: string;
  status: ActorStatus;
  at: string;
  /** The user a staff or agent actor belongs to. */
  user: { id: string; name: string; email: string; status: UserStatus } | null;
  roles: string[];
}

export interface ApiKeyEntry {
  id: string;
  label: string;
  at: string;
  lastUsedAt: string | null;
  revokedAt: string | null;
}

export interface ActorDetail extends ActorEntry {
  keys: ApiKeyEntry[];
}

const actorColumns = {
  id: actors.id,
  kind: actors.kind,
  name: actors.name,
  status: actors.status,
  createdAt: actors.createdAt,
  userId: users.id,
  userName: users.name,
  userEmail: users.email,
  userStatus: users.status,
};

interface ActorRow {
  id: string;
  kind: ActorKind;
  name: string;
  status: ActorStatus;
  createdAt: Date;
  userId: string | null;
  userName: string | null;
  userEmail: string | null;
  userStatus: UserStatus | null;
}

const toEntry = (
  { createdAt, userId, userName, userEmail, userStatus, ...row }: ActorRow,
  roles: string[]
): ActorEntry => ({
  ...row,
  at: iso(createdAt),
  user:
    userId && userEmail && userStatus
      ? {
          id: userId,
          name: userName ?? "",
          email: userEmail,
          status: userStatus,
        }
      : null,
  roles,
});

export const createIdentityReader = (executor: Executor) => {
  const rolesOf = async (ids: string[]) => {
    const byActor = new Map<string, string[]>();
    if (ids.length === 0) {
      return byActor;
    }
    const rows = await executor
      .select()
      .from(actorRoles)
      .where(inArray(actorRoles.actorId, ids))
      .orderBy(asc(actorRoles.roleKey));
    for (const row of rows) {
      byActor.set(row.actorId, [
        ...(byActor.get(row.actorId) ?? []),
        row.roleKey,
      ]);
    }
    return byActor;
  };

  /** Actors, newest first, with their user and roles. */
  const actorList = async (
    filter: ActorFilter = {},
    page: LogPage = {}
  ): Promise<LogResult<ActorEntry>> => {
    const size = sizeOf(page.limit);
    const rows = await executor
      .select(actorColumns)
      .from(actors)
      .leftJoin(users, eq(actors.userId, users.id))
      .where(
        and(
          filter.kind ? eq(actors.kind, filter.kind) : undefined,
          filter.status ? eq(actors.status, filter.status) : undefined,
          filter.userId ? eq(actors.userId, filter.userId) : undefined,
          before(actors.createdAt, actors.id, decode(page.cursor))
        )
      )
      .orderBy(desc(actors.createdAt), desc(actors.id))
      .limit(size + 1);
    const roles = await rolesOf(rows.map((row) => row.id));
    return paged(
      rows.map((row) => toEntry(row, roles.get(row.id) ?? [])),
      size
    );
  };

  /** An actor's API keys, newest first. Never the hash. */
  const apiKeyList = async (actorId: string): Promise<ApiKeyEntry[]> => {
    const rows = await executor
      .select({
        id: apiKeys.id,
        label: apiKeys.label,
        createdAt: apiKeys.createdAt,
        lastUsedAt: apiKeys.lastUsedAt,
        revokedAt: apiKeys.revokedAt,
      })
      .from(apiKeys)
      .where(eq(apiKeys.actorId, actorId))
      .orderBy(desc(apiKeys.createdAt), desc(apiKeys.id));
    return rows.map(({ createdAt, lastUsedAt, revokedAt, ...row }) => ({
      ...row,
      at: iso(createdAt),
      lastUsedAt: isoOrNull(lastUsedAt),
      revokedAt: isoOrNull(revokedAt),
    }));
  };

  /** One actor with its roles and keys, or null. */
  const actorDetail = async (id: string): Promise<ActorDetail | null> => {
    const [row] = await executor
      .select(actorColumns)
      .from(actors)
      .leftJoin(users, eq(actors.userId, users.id))
      .where(eq(actors.id, id));
    if (!row) {
      return null;
    }
    const roles = await rolesOf([id]);
    return {
      ...toEntry(row, roles.get(id) ?? []),
      keys: await apiKeyList(id),
    };
  };

  return { actorList, actorDetail, apiKeyList };
};
