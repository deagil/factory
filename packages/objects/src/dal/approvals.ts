// Reading approvals (P2.09), for `approval.list`: each sign-off with who asked,
// who decided and what it's for, the pending action or the draft. Who may
// read them is the query's job, not this layer's.

import type { Executor } from "@workspace/db";
import { actionLog, actors, approvals, drafts } from "@workspace/db/schema";
import type { approvalStatuses, approvalSubjects } from "@workspace/db/schema";
import { and, desc, eq } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";

import { iso, isoOrNull } from "./logs.ts";

export interface ApprovalEntry {
  id: string;
  subject: (typeof approvalSubjects)[number];
  subjectId: string;
  rule: string;
  approverRole: string;
  status: (typeof approvalStatuses)[number];
  requestedBy: { id: string; name: string };
  decidedBy: { id: string; name: string } | null;
  comment: string | null;
  createdAt: string;
  decidedAt: string | null;
  /** The pending action: its name and input. */
  action: { name: string; input: unknown } | null;
  /** The draft: its title and the files it changes. */
  draft: { title: string; files: string[] } | null;
}

const requester = alias(actors, "requester");
const decider = alias(actors, "decider");

export const createApprovalReader = (executor: Executor) => {
  /** Approvals, newest first, optionally in one status. */
  const approvalList = async (
    filter: {
      status?: ApprovalEntry["status"];
      /** Only the approvals on this action or draft. */
      subjectId?: string;
      limit?: number;
    } = {}
  ): Promise<ApprovalEntry[]> => {
    const rows = await executor
      .select({
        approval: approvals,
        requesterName: requester.name,
        deciderName: decider.name,
        actionName: actionLog.name,
        actionInput: actionLog.input,
        draftTitle: drafts.title,
        draftFiles: drafts.files,
      })
      .from(approvals)
      .leftJoin(requester, eq(approvals.requestedBy, requester.id))
      .leftJoin(decider, eq(approvals.decidedBy, decider.id))
      .leftJoin(
        actionLog,
        and(
          eq(approvals.subject, "action"),
          eq(approvals.subjectId, actionLog.id)
        )
      )
      .leftJoin(
        drafts,
        and(eq(approvals.subject, "draft"), eq(approvals.subjectId, drafts.id))
      )
      .where(
        and(
          filter.status ? eq(approvals.status, filter.status) : undefined,
          filter.subjectId
            ? eq(approvals.subjectId, filter.subjectId)
            : undefined
        )
      )
      .orderBy(desc(approvals.createdAt), desc(approvals.id))
      .limit(filter.limit ?? 50);
    return rows.map(({ approval, ...row }) => ({
      id: approval.id,
      subject: approval.subject,
      subjectId: approval.subjectId,
      rule: approval.ruleKey,
      approverRole: approval.approverRole,
      status: approval.status,
      requestedBy: { id: approval.requestedBy, name: row.requesterName ?? "" },
      decidedBy: approval.decidedBy
        ? { id: approval.decidedBy, name: row.deciderName ?? "" }
        : null,
      comment: approval.comment,
      createdAt: iso(approval.createdAt),
      decidedAt: isoOrNull(approval.decidedAt),
      action:
        row.actionName === null
          ? null
          : { name: row.actionName, input: row.actionInput },
      draft:
        row.draftTitle === null
          ? null
          : { title: row.draftTitle, files: row.draftFiles ?? [] },
    }));
  };

  return { approvalList };
};
