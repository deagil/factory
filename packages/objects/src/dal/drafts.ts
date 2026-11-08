// Reading drafts (P2.08), for `draft.list`, `draft.get` and the draft actions.
// Who may read them is the queries' job, not this layer's.

import type { Executor } from "@workspace/db";
import { actors, drafts } from "@workspace/db/schema";
import type { draftStatuses } from "@workspace/db/schema";
import { and, desc, eq, inArray } from "drizzle-orm";

import { iso, isoOrNull } from "./logs.ts";

export interface DraftEntry {
  id: string;
  branch: string;
  title: string;
  /** Written from its files on each save, until someone names it. */
  autoTitle: boolean;
  files: string[];
  status: (typeof draftStatuses)[number];
  baseSha: string;
  publishedSha: string | null;
  syncedSha: string | null;
  /** The parked draft.publish its last approval runs (decision 0044). */
  publishActionId: string | null;
  createdBy: { id: string; name: string };
  createdAt: string;
  publishedAt: string | null;
}

const columns = {
  id: drafts.id,
  branch: drafts.branch,
  title: drafts.title,
  autoTitle: drafts.autoTitle,
  files: drafts.files,
  status: drafts.status,
  baseSha: drafts.baseSha,
  publishedSha: drafts.publishedSha,
  syncedSha: drafts.syncedSha,
  publishActionId: drafts.publishActionId,
  createdById: drafts.createdBy,
  createdByName: actors.name,
  createdAt: drafts.createdAt,
  publishedAt: drafts.publishedAt,
};

interface Row extends Omit<
  DraftEntry,
  "createdBy" | "createdAt" | "publishedAt"
> {
  createdById: string;
  createdByName: string | null;
  createdAt: Date;
  publishedAt: Date | null;
}

const toEntry = ({
  createdById,
  createdByName,
  createdAt,
  publishedAt,
  ...row
}: Row): DraftEntry => ({
  ...row,
  createdBy: { id: createdById, name: createdByName ?? "" },
  createdAt: iso(createdAt),
  publishedAt: isoOrNull(publishedAt),
});

/** The statuses of a draft that can still change. */
export const openStatuses: DraftEntry["status"][] = [
  "draft",
  "valid",
  "invalid",
  "awaiting_approval",
];

export const createDraftReader = (executor: Executor) => {
  const select = () =>
    executor
      .select(columns)
      .from(drafts)
      .leftJoin(actors, eq(drafts.createdBy, actors.id));

  /**
   * Drafts, newest first: optionally in one status, only open ones (not
   * published or abandoned), or only one actor's.
   */
  const draftList = async (
    filter: {
      status?: DraftEntry["status"];
      open?: boolean;
      createdBy?: string;
      limit?: number;
    } = {}
  ): Promise<DraftEntry[]> => {
    const rows = await select()
      .where(
        and(
          filter.status ? eq(drafts.status, filter.status) : undefined,
          filter.open ? inArray(drafts.status, openStatuses) : undefined,
          filter.createdBy ? eq(drafts.createdBy, filter.createdBy) : undefined
        )
      )
      .orderBy(desc(drafts.createdAt), desc(drafts.id))
      .limit(filter.limit ?? 50);
    return rows.map(toEntry);
  };

  /** One draft, or null. */
  const draftDetail = async (id: string): Promise<DraftEntry | null> => {
    const [row] = await select().where(eq(drafts.id, id));
    return row ? toEntry(row) : null;
  };

  return { draftList, draftDetail };
};
