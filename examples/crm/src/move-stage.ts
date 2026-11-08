// deal.moveStage: the only way to change a deal's stage. It owns the field,
// so deal.update can't, and it records the stage's category on the event.
import { defineAction } from "@workspace/actions";
import { z } from "zod";

import { dealStages } from "./choices.ts";
import { deal } from "./objects.ts";

export const moveStage = defineAction({
  name: "deal.moveStage",
  description:
    "Move a deal to another stage. The only way to change a deal's stage. A lost stage needs a reason.",
  input: z.strictObject({
    id: z.uuid(),
    stage: z.string(),
    /** Why the deal was lost. Required when the stage's category is lost. */
    reason: z.string().optional(),
    /** Fails with a conflict unless the deal is at this version. */
    version: z.number().int().positive().optional(),
  }),
  output: z.object({ record: deal.schemas.record }),
  emits: {
    "deal.stageChanged": z.object({
      dealId: z.uuid(),
      from: z.string(),
      to: z.string(),
      category: dealStages.columns.category,
    }),
  },
  handler: async (ctx, input) => {
    const option = ctx.config.choice?.(dealStages).get(input.stage);
    if (!option) {
      return ctx.invalid(`"${input.stage}" isn't a stage that can be chosen.`);
    }
    if (option.category === "lost" && !input.reason?.trim()) {
      return ctx.invalid("A reason is required for lost deals.");
    }
    const result = await ctx.repo.update(
      deal,
      input.id,
      { stage: input.stage },
      { expectedVersion: input.version }
    );
    switch (result.status) {
      case "not_found": {
        return ctx.notFound("deal", input.id);
      }
      case "archived": {
        return ctx.conflict("This deal is archived, so it can't be moved");
      }
      case "conflict": {
        return ctx.conflict(
          "This deal changed since you read it. Read it again and retry."
        );
      }
      case "unchanged": {
        return { record: result.record };
      }
      case "updated": {
        ctx.emit("deal.stageChanged", {
          dealId: input.id,
          from: String(result.before.stage),
          to: input.stage,
          category: option.category,
        });
        return { record: result.record };
      }
      default: {
        const unexpected: never = result;
        return unexpected;
      }
    }
  },
});
