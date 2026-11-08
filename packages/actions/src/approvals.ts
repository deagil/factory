// Deciding approvals (P2.09, decisions 0042 and 0043). `approval.approve` and
// `approval.reject` are open to every actor; the handler checks that the
// decider is staff, holds the approval's role, isn't the person who asked or
// who it's for, and hasn't already approved the same subject. Once
// every approval on a pending action is approved, it runs in the same
// transaction, once. A draft whose approvals are all approved publishes the
// same way: its parked draft.publish runs as the person who asked (decision
// 0044). Whoever asked can withdraw a request while it waits.
import { z } from "zod";

import { rulesForFiles, signOffsFor } from "./approval-rules.ts";
import type { SignOff } from "./approval-rules.ts";
import { defineAction, defineQuery } from "./define-action.ts";
import type { ActionContext, QueryContext } from "./define-action.ts";

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

/** One approval, as `approval.list` and `draft.get` return it. */
export type ApprovalEntry = z.infer<typeof approvalEntrySchema>;

const decisionInput = z.strictObject({
  id: z.uuid(),
  comment: z.string().max(2000).optional(),
});

const decided = z.object({
  id: z.uuid(),
  status: statusSchema,
});

/**
 * Puts a draft whose request is over back to valid, and returns the parked
 * draft.publish it had, if any, which is still pending.
 */
const settleDraft = async (
  ctx: ActionContext<Record<never, never>>,
  draftId: string
) => {
  const draft = await ctx.dal.draftDetail(draftId);
  await ctx.drafts.update(draftId, { status: "valid", publishActionId: null });
  return draft?.publishActionId ?? null;
};

/** The approval, locked, if `ctx.actor` may decide it now; or why not. */
const decidable = async (
  ctx: ActionContext<Record<never, never>>,
  id: string
) => {
  const locked = await ctx.approvals.lock(id);
  if (!locked) {
    return ctx.notFound("approval", id);
  }
  const { approval, barred } = locked;
  if (approval.status !== "pending") {
    return ctx.conflict(`This approval is already ${approval.status}.`);
  }
  if (ctx.actor.kind !== "staff" || !ctx.granted.holds(approval.approverRole)) {
    return ctx.forbidden(
      `role:${approval.approverRole}`,
      `Only staff with the ${approval.approverRole} role can decide this.`
    );
  }
  // Nobody decides their own request, nor one an agent made for them.
  if (
    barred.actorIds.includes(ctx.actor.id) ||
    (ctx.actor.userId !== null && barred.userIds.includes(ctx.actor.userId))
  ) {
    return ctx.forbidden(
      `role:${approval.approverRole}`,
      "This was asked for by you or for you, so someone else must decide it."
    );
  }
  // Each approval on one subject needs a different person.
  const rows = await ctx.approvals.forSubject(
    approval.subject,
    approval.subjectId
  );
  if (
    rows.some(
      (row) => row.status === "approved" && row.decidedBy === ctx.actor.id
    )
  ) {
    return ctx.forbidden(
      `role:${approval.approverRole}`,
      "You've already approved this, so someone else must give the next approval."
    );
  }
  return { approval };
};

export const approvalApprove = defineAction({
  name: "approval.approve",
  description:
    "Approve a pending approval. When it's the last one a pending action or draft needs, the action runs now, once, as the person who asked; a draft publishes, as the person who asked to publish it.",
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
    // A draft's parked draft.publish runs now; a pending action itself.
    const parked =
      subject === "draft" ? await settleDraft(ctx, subjectId) : subjectId;
    if (parked === null) {
      return { approval, ran: null };
    }
    const result = await ctx.approvals.resume(parked);
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
    "Reject a pending approval. A pending action is then never run; a draft goes back to valid, to change and publish again.",
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
    const parked =
      subject === "action" ? subjectId : await settleDraft(ctx, subjectId);
    if (parked) {
      await ctx.approvals.close(parked, "rejected");
    }
    return { approval };
  },
});

export const approvalWithdraw = defineAction({
  name: "approval.withdraw",
  description:
    "Withdraw a request for approval you made, or one made for you, such as by your agent: a pending action never runs, and a draft goes back to valid, to change and publish again. Takes the pending action's or the draft's id.",
  input: z.strictObject({ subjectId: z.uuid() }),
  output: z.object({ withdrawn: z.number().int() }),
  everyone: true,
  handler: async (ctx, { subjectId }) => {
    const waiting = await ctx.dal.approvalList({
      subjectId,
      status: "pending",
      limit: 1,
    });
    const [first] = waiting;
    if (!first) {
      return ctx.notFound("pending approval", subjectId);
    }
    const locked = await ctx.approvals.lock(first.id);
    if (!locked) {
      return ctx.notFound("pending approval", subjectId);
    }
    const { approval, barred } = locked;
    const asked =
      barred.actorIds.includes(ctx.actor.id) ||
      (ctx.actor.userId !== null && barred.userIds.includes(ctx.actor.userId));
    if (!asked) {
      return ctx.forbidden(
        "approval.withdraw",
        "Only the person who asked, or whoever it was asked for, can withdraw it."
      );
    }
    const rows = await ctx.approvals.forSubject(approval.subject, subjectId);
    const pending = rows.filter((row) => row.status === "pending").length;
    await ctx.approvals.cancelPending(
      approval.subject,
      subjectId,
      ctx.clock.now()
    );
    const parked =
      approval.subject === "action"
        ? subjectId
        : await settleDraft(ctx, subjectId);
    if (parked) {
      await ctx.approvals.close(parked, "withdrawn");
    }
    return { withdrawn: pending };
  },
});

/** The caller as the approval filters see it. */
const caller = (ctx: QueryContext) => ({
  actorId: ctx.actor.id,
  userId: ctx.actor.userId,
});

export const approvalList = defineQuery({
  name: "approval.list",
  description:
    "Approvals, newest first, optionally in one status: what each is for (a pending action or a draft), the rule, the role that decides, and who asked and decided. mine lists the ones you asked for, or were asked for you; decidable lists the pending ones you could decide now; recordId those on pending actions on one record.",
  input: z.strictObject({
    status: statusSchema.optional(),
    /** Only the approvals on this pending action or draft. */
    subjectId: z.uuid().optional(),
    /** Only those on pending actions whose input names this record as id. */
    recordId: z.uuid().optional(),
    /** Only those asked by the caller, or for them. */
    mine: z.boolean().optional(),
    /** Only pending ones the caller could decide now. */
    decidable: z.boolean().optional(),
    limit: z.number().int().min(1).max(200).optional(),
  }),
  output: z.object({ approvals: z.array(approvalEntrySchema) }),
  handler: async (ctx, { mine, decidable: canDecide, ...input }) => {
    if (canDecide && ctx.actor.kind !== "staff") {
      return { approvals: [] };
    }
    return {
      approvals: await ctx.dal.approvalList({
        ...input,
        ...(mine ? { askedBy: caller(ctx) } : {}),
        ...(canDecide
          ? {
              decidableBy: {
                ...caller(ctx),
                roles: ctx.config.roles
                  .map((role) => role.key)
                  .filter((key) => ctx.granted.holds(key)),
              },
            }
          : {}),
      }),
    };
  },
});

const signOffSchema = z.object({
  rule: z.string(),
  label: z.string(),
  approverRole: z.string(),
  approvals: z.number().int(),
});

export const approvalCheck = defineQuery({
  name: "approval.check",
  description:
    "Whether something you're about to do needs approval, and from whom: running an action with an input, or publishing a draft. Lists the sign-offs the approval rules would ask of you now; empty when it can go ahead.",
  input: z
    .strictObject({
      action: z.string().optional(),
      input: z.unknown().optional(),
      draftId: z.uuid().optional(),
    })
    .refine(
      (each) => (each.action === undefined) !== (each.draftId === undefined),
      {
        message: "Give either action (with its input) or draftId",
        path: ["action"],
      }
    ),
  output: z.object({ signOffs: z.array(signOffSchema) }),
  everyone: true,
  handler: async (ctx, { action, input, draftId }) => {
    const rules = ctx.config.approvals ?? [];
    let needed: SignOff[] = [];
    if (draftId) {
      const draft = await ctx.dal.draftDetail(draftId);
      if (!draft) {
        return ctx.notFound("draft", draftId);
      }
      needed = signOffsFor(
        rulesForFiles(rules, draft.files),
        ctx.actor,
        ctx.granted
      );
    } else if (action && ctx.signOffs) {
      needed = await ctx.signOffs(action, input ?? {});
    }
    return {
      signOffs: needed.map((each) => ({
        rule: each.ruleKey,
        label: rules.find((rule) => rule.key === each.ruleKey)?.label ?? "",
        approverRole: each.approverRole,
        approvals: each.count,
      })),
    };
  },
});

/** The approval actions and query, which a system with config has. */
export const approvalDefinitions = [
  approvalApprove,
  approvalReject,
  approvalWithdraw,
  approvalList,
  approvalCheck,
] as const;
