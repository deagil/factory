// contact.moveToOrganisation: the one hand-written action. It owns the
// contact's organisation field, so the generated contact_update can't change
// it, and it says so with its own event.
import { defineAction } from "@workspace/actions";
import { z } from "zod";

import { contact, organisation } from "./objects.ts";

export const moveToOrganisation = defineAction({
  name: "contact.moveToOrganisation",
  description:
    "Move a contact to another organisation. The only way to change a contact's organisation.",
  input: z.strictObject({
    id: z.uuid(),
    organisation: z.uuid(),
    /** Fails with a conflict unless the contact is at this version. */
    version: z.number().int().positive().optional(),
  }),
  output: z.object({ record: contact.schemas.record }),
  emits: {
    "contact.moved": z.object({
      contactId: z.uuid(),
      from: z.uuid().nullable(),
      to: z.uuid(),
    }),
  },
  handler: async (ctx, input) => {
    const target = await ctx.dal.get(organisation, input.organisation);
    if (!target) {
      return ctx.notFound("organisation", input.organisation);
    }
    const result = await ctx.repo.update(
      contact,
      input.id,
      { organisation: input.organisation },
      { expectedVersion: input.version }
    );
    switch (result.status) {
      case "not_found": {
        return ctx.notFound("contact", input.id);
      }
      case "archived": {
        return ctx.conflict("This contact is archived, so it can't be moved");
      }
      case "refused": {
        // A hand-written action writes as the service key does, so its
        // repository has no rules to refuse it; kept for the type.
        return ctx.invalid(result.message);
      }
      case "conflict": {
        return ctx.conflict(
          "This contact changed since you read it. Read it again and retry."
        );
      }
      case "updated": {
        ctx.emit("contact.moved", {
          contactId: input.id,
          from: (result.before.organisation as string | null) ?? null,
          to: input.organisation,
        });
        return { record: result.record };
      }
      default: {
        return { record: result.record };
      }
    }
  },
});
