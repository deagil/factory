// `record.history`: every change to one record, newest first, from
// `audit_log` with the action and actor behind each one. One
// `audit_log` row is one entry (decision 0018).
import type { AnyObjectDefinition } from "@workspace/objects";
import { z } from "zod";

import { defineQuery } from "./define-action.ts";

const changes = z.record(z.string(), z.unknown());

export const historyEntrySchema = z.object({
  id: z.uuid(),
  at: z.iso.datetime({ offset: true }),
  action: z.string(),
  actionId: z.uuid(),
  actor: z.object({ id: z.uuid(), name: z.string(), kind: z.string() }),
  /** The user an agent or workflow acted for; null for staff. */
  onBehalfOf: z.object({ id: z.string(), name: z.string() }).nullable(),
  before: changes,
  after: changes,
});

export type HistoryEntry = z.infer<typeof historyEntrySchema>;

/** The `record.history` query over a system's objects. */
export const historyQuery = (objects: readonly AnyObjectDefinition[]) => {
  const names = objects.map((object) => object.name);
  return defineQuery({
    name: "record.history",
    description:
      "Every change to one record, newest first: which fields changed from what to what, through which action, and who made it.",
    input: z.strictObject({
      object: z.enum(names as [string, ...string[]]),
      id: z.uuid(),
    }),
    output: z.object({ entries: z.array(historyEntrySchema) }),
    // Open to everyone; the handler checks the object's view permission.
    everyone: true,
    handler: async (ctx, input) => {
      const object = objects.find(
        (candidate) => candidate.name === input.object
      );
      if (!object || ctx.granted.canRead(object) === "none") {
        return ctx.forbidden(`${input.object}.view`);
      }
      return { entries: await ctx.dal.history(object, input.id) };
    },
  });
};
