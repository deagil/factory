// Writes to `approvals` (P2.09, decision 0042), for the pipeline and the
// approval and draft actions through `ctx.approvals`. Bound to the run's
// transaction. The approvals inbox reads through the data access layer.
import { and, asc, eq, inArray } from "drizzle-orm";

import type { Executor } from "./client.ts";
import { actors, approvals, drafts, runs } from "./schema/core.ts";
import type { approvalStatuses, approvalSubjects } from "./schema/core.ts";

export type ApprovalSubject = (typeof approvalSubjects)[number];
export type ApprovalStatus = (typeof approvalStatuses)[number];
export type ApprovalRow = typeof approvals.$inferSelect;

/**
 * One sign-off to ask for: the rule that asked, the role that decides and
 * how many different people must approve. Each gets its own row.
 */
export interface ApprovalRequest {
  ruleKey: string;
  approverRole: string;
  count: number;
}

/** A locked approval, and the people who may not decide it. */
export interface LockedApproval {
  approval: ApprovalRow;
  /**
   * Who asked and who it's for: the requesting actor and its user, the
   * action's origin user, and a draft's creator and their user.
   */
  barred: { actorIds: string[]; userIds: string[] };
}

/** The ids that are there, once each. */
const known = (ids: (string | null | undefined)[]) => [
  ...new Set(ids.filter((each): each is string => Boolean(each))),
];

export const createApprovalStore = (executor: Executor) => {
  const cancel = async (
    subject: ApprovalSubject,
    subjectId: string,
    statuses: ApprovalStatus[],
    at: Date
  ) => {
    await executor
      .update(approvals)
      .set({ status: "cancelled", decidedAt: at })
      .where(
        and(
          eq(approvals.subject, subject),
          eq(approvals.subjectId, subjectId),
          inArray(approvals.status, statuses)
        )
      );
  };

  return {
    /** Asks for one sign-off per request, all by `requestedBy`. */
    request: async (
      subject: ApprovalSubject,
      subjectId: string,
      requests: readonly ApprovalRequest[],
      requestedBy: string
    ): Promise<ApprovalRow[]> => {
      if (requests.length === 0) {
        return [];
      }
      const rows = await executor
        .insert(approvals)
        .values(
          requests.flatMap(({ count, ...each }) =>
            Array.from({ length: count }, () => ({
              ...each,
              subject,
              subjectId,
              requestedBy,
              status: "pending" as const,
            }))
          )
        )
        .returning();
      return rows;
    },

    /**
     * The approval, with its subject's row locked for the rest of the
     * transaction, so decisions on one subject happen one at a time.
     */
    lock: async (id: string): Promise<LockedApproval | null> => {
      const [found] = await executor
        .select({ subject: approvals.subject, subjectId: approvals.subjectId })
        .from(approvals)
        .where(eq(approvals.id, id));
      if (!found) {
        return null;
      }
      // Who the subject is by or for: a run's actor and origin user, a
      // draft's creator.
      const [subject] =
        found.subject === "run"
          ? await executor
              .select({ actorId: runs.actorId, userId: runs.originUserId })
              .from(runs)
              .where(eq(runs.id, found.subjectId))
              .for("update")
          : await executor
              .select({ actorId: drafts.createdBy, userId: actors.userId })
              .from(drafts)
              .leftJoin(actors, eq(actors.id, drafts.createdBy))
              .where(eq(drafts.id, found.subjectId))
              .for("update", { of: drafts });
      const [row] = await executor
        .select({ approval: approvals, requesterUserId: actors.userId })
        .from(approvals)
        .leftJoin(actors, eq(actors.id, approvals.requestedBy))
        .where(eq(approvals.id, id))
        .for("update", { of: approvals });
      if (!row) {
        return null;
      }
      return {
        approval: row.approval,
        barred: {
          actorIds: known([row.approval.requestedBy, subject?.actorId]),
          userIds: known([row.requesterUserId, subject?.userId]),
        },
      };
    },

    /** Every approval for a subject, oldest first. */
    forSubject: (
      subject: ApprovalSubject,
      subjectId: string
    ): Promise<ApprovalRow[]> =>
      executor
        .select()
        .from(approvals)
        .where(
          and(
            eq(approvals.subject, subject),
            eq(approvals.subjectId, subjectId)
          )
        )
        .orderBy(asc(approvals.createdAt), asc(approvals.id)),

    /** Records a decision on a pending approval. */
    decide: async (
      id: string,
      decision: {
        status: "approved" | "rejected";
        decidedBy: string;
        comment: string | null;
        decidedAt: Date;
      }
    ): Promise<ApprovalRow> => {
      const [row] = await executor
        .update(approvals)
        .set(decision)
        .where(and(eq(approvals.id, id), eq(approvals.status, "pending")))
        .returning();
      if (!row) {
        throw new Error(`Approval ${id} isn't pending.`);
      }
      return row;
    },

    /**
     * Cancels a subject's pending and approved rows, as saving or
     * resubmitting a draft does: what they approved has changed.
     */
    cancelOpen: (subject: ApprovalSubject, subjectId: string, at: Date) =>
      cancel(subject, subjectId, ["pending", "approved"], at),

    /** Cancels a subject's pending rows, once it's rejected or published. */
    cancelPending: (subject: ApprovalSubject, subjectId: string, at: Date) =>
      cancel(subject, subjectId, ["pending"], at),
  };
};

/** Approval rows, as the pipeline hands them to actions in `ctx.approvals`. */
export type ApprovalStore = ReturnType<typeof createApprovalStore>;
