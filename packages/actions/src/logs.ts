// The log queries (P1b.02): `actionLog.list`, `actionLog.get`,
// `auditLog.list` and `eventLog.list`. Each needs a permission on its own
// name. Without it, anyone may still read their own actions: those they
// performed, or that an agent or workflow did for them.
import { z } from "zod";

import { defineQuery } from "./define-action.ts";
import type { AnyDefinition } from "./define-action.ts";
import {
  actionLogDetailSchema,
  actionLogEntrySchema,
  actionStatuses,
  changeEntrySchema,
  eventEntrySchema,
  page,
  pageOf,
  range,
} from "./log-schemas.ts";
import type { Granted } from "./permissions.ts";

/** Whether the caller holds the permission named `name`. */
const holds = (granted: Granted, name: string) =>
  granted.authorise({
    kind: "query",
    name,
    everyone: false,
  } as unknown as AnyDefinition) === null;

export const actionLogList = defineQuery({
  name: "actionLog.list",
  description:
    "Actions that ran, newest first: who ran them, for whom, and whether they succeeded. Without the actionLog.list permission, only your own actions and those done for you.",
  input: z.strictObject({
    actorId: z.uuid().optional(),
    name: z.string().optional(),
    /** A name prefix, as `contact.` for every contact action. */
    namePrefix: z.string().optional(),
    status: z.enum(actionStatuses).optional(),
    dryRun: z.boolean().optional(),
    ...range,
    ...page,
  }),
  output: pageOf(actionLogEntrySchema),
  // Open to everyone; the handler narrows to the caller's own actions.
  everyone: true,
  handler: (ctx, { cursor, limit, ...filter }) =>
    ctx.dal.actions(
      holds(ctx.granted, "actionLog.list")
        ? filter
        : {
            ...filter,
            involving: { actorId: ctx.actor.id, userId: ctx.actor.userId },
          },
      { cursor, limit }
    ),
});

export const actionLogGet = defineQuery({
  name: "actionLog.get",
  description:
    "One action that ran: its input, result or error, and the changes and events it wrote. Without the actionLog.get permission, only your own.",
  input: z.strictObject({ id: z.uuid() }),
  output: z.object({ action: actionLogDetailSchema }),
  everyone: true,
  handler: async (ctx, { id }) => {
    const action = await ctx.dal.action(id);
    if (!action) {
      return ctx.notFound("action", id);
    }
    const own =
      action.actor.id === ctx.actor.id ||
      (ctx.actor.userId !== null && action.origin?.id === ctx.actor.userId);
    if (!(own || holds(ctx.granted, "actionLog.get"))) {
      return ctx.forbidden("actionLog.get");
    }
    return { action };
  },
});

export const auditLogList = defineQuery({
  name: "auditLog.list",
  description:
    "Changes to records, newest first: which fields changed from what to what, through which action, and who made them. Filter by object, record, field, actor or action.",
  input: z.strictObject({
    object: z.string().optional(),
    recordId: z.uuid().optional(),
    /** Only changes to this field. */
    field: z.string().optional(),
    actorId: z.uuid().optional(),
    actionId: z.uuid().optional(),
    ...range,
    ...page,
  }),
  output: pageOf(changeEntrySchema),
  handler: (ctx, { cursor, limit, ...filter }) =>
    ctx.dal.changes(filter, { cursor, limit }),
});

export const eventLogList = defineQuery({
  name: "eventLog.list",
  description:
    "Events actions emitted, newest first, with their payloads. Filter by type, type prefix or action.",
  input: z.strictObject({
    type: z.string().optional(),
    /** A type prefix, as `contact.` for every contact event. */
    typePrefix: z.string().optional(),
    actionId: z.uuid().optional(),
    ...range,
    ...page,
  }),
  output: pageOf(eventEntrySchema),
  handler: (ctx, { cursor, limit, ...filter }) =>
    ctx.dal.events(filter, { cursor, limit }),
});

/** Every log query, for defineSystem to register. */
export const logQueries = [
  actionLogList,
  actionLogGet,
  auditLogList,
  eventLogList,
] as const;
