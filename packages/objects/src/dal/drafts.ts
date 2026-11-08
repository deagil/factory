// Reading drafts (P2.08), for `draft.list`, `draft.get` and the draft actions.
// Who may read them is the queries' job, not this layer's.

import type { Executor } from "@workspace/db";
import { actors, drafts } from "@workspace/db/schema";
import type { draftStatuses } from "@workspace/db/schema";
import { desc, eq } from "drizzle-orm";

import { iso, isoOrNull } from "./logs.ts";

export interface DraftEntry {
  id: string;
  branch: string;
  title: string;
  files: string[];
  status: (typeof draftStatuses)[number];
  baseSha: string;
  publishedSha: string | null;
  syncedSha: string | null;
  createdBy: { id: string; name: string };
  createdAt: string;
  publishedAt: string | null;
}

const columns = {
  id: drafts.id,
  branch: drafts.branch,
  title: drafts.title,
  files: drafts.files,
  status: drafts.status,
  baseSha: drafts.baseSha,
  publishedSha: drafts.publishedSha,
  syncedSha: drafts.syncedSha,
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

export const createDraftReader = (executor: Executor) => {
  const select = () =>
    executor
      .select(columns)
      .from(drafts)
      .leftJoin(actors, eq(drafts.createdBy, actors.id));

  /** Drafts, newest first, optionally in one status. */
  const draftList = async (
    filter: { status?: DraftEntry["status"]; limit?: number } = {}
  ): Promise<DraftEntry[]> => {
    const rows = await select()
      .where(filter.status ? eq(drafts.status, filter.status) : undefined)
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
