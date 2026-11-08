// Writes to `drafts` (P2.08), for the draft actions through `ctx.drafts`.
// Bound to the run's transaction. Reads go through the data access layer.
import { eq, sql } from "drizzle-orm";

import type { Executor } from "./client.ts";
import type { draftStatuses } from "./schema/core.ts";
import { drafts } from "./schema/core.ts";

export type DraftStatus = (typeof draftStatuses)[number];

export interface DraftChanges {
  title?: string;
  autoTitle?: boolean;
  status?: DraftStatus;
  files?: string[];
  publishedSha?: string;
  syncedSha?: string | null;
  publishedAt?: Date;
  /** The parked draft.publish the last approval runs, or null for none. */
  publishActionId?: string | null;
}

export const createDraftStore = (executor: Executor) => ({
  /** A new draft's id, before its branch is made: the branch is named after it. */
  newId: async (): Promise<string> => {
    const { rows } = await executor.execute<{ id: string }>(
      sql`select uuidv7() as id`
    );
    const [row] = rows;
    if (!row) {
      throw new Error("uuidv7() returned nothing");
    }
    return row.id;
  },
  create: async (values: {
    id: string;
    branch: string;
    title: string;
    autoTitle?: boolean;
    baseSha: string;
    createdBy: string;
  }) => {
    const [draft] = await executor
      .insert(drafts)
      .values({ ...values, status: "draft" })
      .returning();
    if (!draft) {
      throw new Error("insert returned no draft");
    }
    return draft;
  },
  update: async (id: string, changes: DraftChanges) => {
    const [draft] = await executor
      .update(drafts)
      .set(changes)
      .where(eq(drafts.id, id))
      .returning();
    if (!draft) {
      throw new Error(`No draft ${id}`);
    }
    return draft;
  },
});

/** Writes to drafts, as actions get them through `ctx.drafts`. */
export type DraftStore = ReturnType<typeof createDraftStore>;
