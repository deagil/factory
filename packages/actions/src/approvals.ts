// Deciding approvals (P2.09, decision 0042). `approval.approve` and
// `approval.reject` are open to every actor; the handler checks that the
// decider is staff, holds the approval's role and didn't ask for it. Once
// every approval on a pending action is approved, it runs in the same
// transaction, once. A draft whose approvals are all approved can publish.
import { z } from "zod";

import { defineAction, defineQuery } from "./define-action.ts";
import type { ActionContext } from "./define-action.ts";

const statusSchema = z.enum(["pending", "approved", "rejected", "cancelled"]);
const who = z.object({ id: z.uuid(), name: z.string() });

export const approvalEntrySchema = z.object({
  id: z.uuid(),
  subject: z.enum(["action", "draft"]),
  subjectId: z.uuid(),
  rule: z.string(),
  approverRole: z.string(),
  status: statusSchema,
  requestedBy: who,
  decidedBy: who.nullable(),
  comment: z.string().nullable(),
  createdAt: z.string(),
  decidedAt: z.string().nullable(),
  action: z.object({ name: z.string(), input: z.unknown() }).nullable(),
  draft: z.object({ title: z.string(), files: z.array(z.string()) }).nullable(),
});

const decisionInput = z.strictObject({
  id: z.uuid(),
  comment: z.string().max(2000).optional(),
});

const decided = z.object({
  id: z.uuid(),
  status: statusSchema,
});

/** The approval, locked, if `ctx.actor` may decide it now; or why not. */
const decidable = async (
  ctx: ActionContext<Record<never, never>>,
  id: string
) => {
  const approval = await ctx.approvals.lock(id);
  if (!approval) {
    return ctx.notFound("approval", id);
  }
  if (approval.status !== "pending") {
    return ctx.conflict(`This approval is already ${approval.status}.`);
  }
  if (ctx.actor.kind !== "staff" || !ctx.granted.holds(approval.approverRole)) {
    return ctx.forbidden(
      `role:${approval.approverRole}`,
      `Only staff with the ${approval.approverRole} role can decide this.`
    );
  }
  if (approval.requestedBy === ctx.actor.id) {
    return ctx.forbidden(
      `role:${approval.approverRole}`,
      "You asked for this, so someone else must decide it."
    );
  }
  return { approval };
};

export const approvalApprove = defineAction({
  name: "approval.approve",
  description:
    "Approve a pending approval. When it's the last one a pending action needs, the action runs now, once, as the person who asked. A draft whose approvals are all approved can be published.",
  input: decisionInput,
  output: z.object({
    approval: decided,
    ran: z
      .object({
        actionId: z.uuid(),
        ok: z.boolean(),
        output: z.unknown(),
        error: z.object({ code: z.string(), message: z.string() }).nullable(),
      })
      .nullable(),
  }),
  everyone: true,
  handler: async (ctx, { id, comment }) => {
    const found = await decidable(ctx, id);
    if (!("approval" in found)) {
      return found;
    }
    const { subject, subjectId } = found.approval;
    const approval = await ctx.approvals.decide(id, {
      status: "approved",
      decidedBy: ctx.actor.id,
      comment: comment ?? null,
      decidedAt: ctx.clock.now(),
    });
    const rows = await ctx.approvals.forSubject(subject, subjectId);
    if (rows.some((row) => row.status === "pending")) {
      return { approval, ran: null };
    }
    if (subject === "draft") {
      await ctx.drafts.update(subjectId, { status: "valid" });
      return { approval, ran: null };
    }
    const result = await ctx.approvals.resume(subjectId);
    return {
      approval,
      ran: result.ok
        ? { actionId: subjectId, ok: true, output: result.output, error: null }
        : {
            actionId: subjectId,
            ok: false,
            output: null,
            error: { code: result.error.code, message: result.error.message },
          },
    };
  },
});

export const approvalReject = defineAction({
  name: "approval.reject",
  description:
    "Reject a pending approval. A pending action is then never run; a draft goes back to valid, to change and submit again.",
  input: decisionInput,
  output: z.object({ approval: decided }),
  everyone: true,
  handler: async (ctx, { id, comment }) => {
    const found = await decidable(ctx, id);
    if (!("approval" in found)) {
      return found;
    }
    const { subject, subjectId } = found.approval;
    const approval = await ctx.approvals.decide(id, {
      status: "rejected",
      decidedBy: ctx.actor.id,
      comment: comment ?? null,
      decidedAt: ctx.clock.now(),
    });
    // The other sign-offs on it no longer matter.
    await ctx.approvals.cancelPending(subject, subjectId, ctx.clock.now());
    await (subject === "action"
      ? ctx.approvals.close(subjectId)
      : ctx.drafts.update(subjectId, { status: "valid" }));
    return { approval };
  },
});

export const approvalList = defineQuery({
  name: "approval.list",
  description:
    "Approvals, newest first, optionally in one status: what each is for (a pending action or a draft), the rule, the role that decides, and who asked and decided.",
  input: z.strictObject({
    status: statusSchema.optional(),
    limit: z.number().int().min(1).max(200).optional(),
  }),
  output: z.object({ approvals: z.array(approvalEntrySchema) }),
  handler: async (ctx, input) => ({
    approvals: await ctx.dal.approvalList(input),
  }),
});

/** The approval actions and query, which a system with config has. */
export const approvalDefinitions = [
  approvalApprove,
  approvalReject,
  approvalList,
] as const;
