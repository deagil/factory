// deal.create, hand-written so a new deal starts in an open stage. A deal
// reaches won or lost only through deal.moveStage, which needs a reason for
// lost and says so with deal.stageChanged.
import { defineAction } from "@workspace/actions";
import { z } from "zod";

import { deal } from "./objects.ts";

// The object's create schema is a strict object at run time, typed by what
// it parses to; defineAction needs it as an object schema.
const input = deal.schemas.create as unknown as z.ZodObject &
  z.ZodType<z.infer<typeof deal.schemas.create>>;

export const createDeal = defineAction({
  name: "deal.create",
  description:
    "Create a deal. It starts in an open stage; move it on with deal.moveStage.",
  input,
  output: z.object({ record: deal.schemas.record }),
  emits: { "deal.created": z.object({ record: deal.schemas.record }) },
  handler: async (ctx, values) => {
    const option = ctx.config.choice?.("deal-stages").get(values.stage);
    if (!option) {
      return ctx.invalid(`"${values.stage}" isn't a stage that can be chosen.`);
    }
    if (option.category !== "open") {
      return ctx.invalid(
        `A new deal starts in an open stage, not "${option.label}". Create it, then move it with deal.moveStage.`
      );
    }
    const record = await ctx.repo.create(deal, values);
    ctx.emit("deal.created", { record });
    return { record };
  },
});
