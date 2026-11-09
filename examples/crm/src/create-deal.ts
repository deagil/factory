// deal_create, hand-written so a new deal starts in an open stage. A deal
// reaches won or lost only through deal.moveStage, which needs a reason for
// lost and says so with deal.stageChanged. A new deal is the caller's (their
// person's, for an agent) unless they name an owner, which only someone who
// reaches every deal may do (P2.14).
import { defineAction } from "@workspace/actions";
import { createdRecord } from "@workspace/objects";
import { z } from "zod";

import { dealStages } from "./choices.ts";
import { deal } from "./objects.ts";

// The object's create schema is a strict object at run time, typed by what
// it parses to; defineAction needs it as an object schema.
const input = deal.schemas.create as unknown as z.ZodObject &
  z.ZodType<z.infer<typeof deal.schemas.create>>;

export const createDeal = defineAction({
  name: "deal_create",
  kind: "internal",
  description:
    "Create a deal. It starts in an open stage; move it on with deal.moveStage.",
  input,
  output: z.object({ record: deal.schemas.record }),
  emits: { deal_created: z.object({ record: deal.schemas.record }) },
  handler: async (ctx, values) => {
    const option = ctx.config.choice?.(dealStages).get(values.stage);
    if (!option) {
      return ctx.invalid(`"${values.stage}" isn't a stage that can be chosen.`);
    }
    if (option.category !== "open") {
      return ctx.invalid(
        `A new deal starts in an open stage, not "${option.label}". Create it, then move it with deal.moveStage.`
      );
    }
    const { ownerId } = ctx.granted;
    const owner = values.owner ?? ownerId;
    if (ctx.granted.on(deal)?.rows === "own" && owner !== ownerId) {
      return ctx.forbidden(
        "deal_create",
        "A new deal has to be yours: leave its owner empty or set it to you."
      );
    }
    const record = createdRecord(
      await ctx.repo.create(deal, { ...values, owner })
    );
    ctx.emit("deal_created", { record });
    return { record };
  },
});
