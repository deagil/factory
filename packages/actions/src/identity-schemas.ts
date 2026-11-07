// Output schemas for the identity queries (P1b.04). They live apart from the
// queries because they need the core's enums, and files that define
// handlers may not import @workspace/db (decision 0019).
import { actorKinds, actorStatuses, userStatuses } from "@workspace/db/schema";
import { z } from "zod";

const timestamp = z.iso.datetime({ offset: true });

export const actorKind = z.enum(actorKinds);
export const actorStatus = z.enum(actorStatuses);

export const actorEntrySchema = z.object({
  id: z.uuid(),
  kind: actorKind,
  name: z.string(),
  status: actorStatus,
  at: timestamp,
  /** The user a staff or agent actor belongs to. */
  user: z
    .object({
      id: z.uuid(),
      name: z.string(),
      email: z.string(),
      status: z.enum(userStatuses),
    })
    .nullable(),
  roles: z.array(z.string()),
});

export const apiKeyEntrySchema = z.object({
  id: z.uuid(),
  label: z.string(),
  at: timestamp,
  lastUsedAt: timestamp.nullable(),
  revokedAt: timestamp.nullable(),
});

export const actorDetailSchema = actorEntrySchema.extend({
  keys: z.array(apiKeyEntrySchema),
});
