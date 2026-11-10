// The log queries (P1b.02): `run.list`, `run.get` (P2.12, which replaced
// `actionLog.*`), `auditLog.list`, `auditLog.get`, `eventLog.list` and
// `eventLog.get`. Each needs a permission on its own name. Without it,
// anyone may still read their own runs: those they performed, or that an
// agent or workflow did for them.
import { z } from "zod";

import { defineQuery } from "./define-action.ts";
import type { AnyDefinition } from "./define-action.ts";
import {
  changeEntrySchema,
  eventEntrySchema,
  page,
  pageOf,
  range,
  runDetailSchema,
  runEntrySchema,
  runStatuses,
} from "./log-schemas.ts";
import type { Granted } from "./permissions.ts";

/** Whether the caller holds the permission named `name`. */
const holds = (granted: Granted, name: string) =>
  granted.authorise({
    kind: "query",
    name,
    everyone: false,
  } as unknown as AnyDefinition) === null;

export const runList = defineQuery({
  name: "run.list",
  description:
    "Runs, newest first: each call of an endpoint, who made it, for whom, and how it ended. Without the run.list permission, only your own runs and those done for you.",
  input: z.strictObject({
    actorId: z.uuid().optional(),
    endpoint: z.string().optional(),
    /** An endpoint prefix, as `contact.` for every contact endpoint. */
    endpointPrefix: z.string().optional(),
    status: z.enum(runStatuses).optional(),
    dryRun: z.boolean().optional(),
    ...range,
    ...page,
  }),
  output: pageOf(runEntrySchema),
  // Open to everyone; the handler narrows to the caller's own runs.
  everyone: true,
  handler: (ctx, { cursor, limit, ...filter }) =>
    ctx.dal.runList(
      holds(ctx.granted, "run.list")
        ? filter
        : {
            ...filter,
            involving: { actorId: ctx.actor.id, userId: ctx.actor.userId },
          },
      { cursor, limit }
    ),
});

export const runGet = defineQuery({
  name: "run.get",
  description:
    "One run: its input, output or error, each step, and the changes and events it wrote. Without the run.get permission, only your own.",
  input: z.strictObject({ id: z.uuid() }),
  output: z.object({ run: runDetailSchema }),
  everyone: true,
  handler: async (ctx, { id }) => {
    const run = await ctx.dal.runGet(id);
    if (!run) {
      return ctx.notFound("run", id);
    }
    const own =
      run.actor.id === ctx.actor.id ||
      (ctx.actor.userId !== null && run.origin?.id === ctx.actor.userId);
    if (!(own || holds(ctx.granted, "run.get"))) {
      return ctx.forbidden("run.get");
    }
    return { run };
  },
});

export const runNeedsAttention = defineQuery({
  name: "run.needsAttention",
  description:
    "Runs that need attention from a role you hold, newest first: a step failed after earlier steps were committed and nothing undid them (P2.20). Someone can retry one, run its failure steps, or mark it resolved.",
  input: z.strictObject({ ...range, ...page }),
  output: pageOf(runEntrySchema),
  everyone: true,
  handler: async (ctx, { cursor, limit, ...filter }) => {
    const named = await ctx.dal.attentionRoles();
    return ctx.dal.runList(
      {
        ...filter,
        status: "needs_attention",
        attentionRoles: named.filter((role) => ctx.granted.holds(role)),
      },
      { cursor, limit }
    );
  },
});

export const auditLogList = defineQuery({
  name: "auditLog.list",
  description:
    "Changes to records, newest first: which fields changed from what to what, in which run, and who made them. Filter by object, record, field, actor or run.",
  input: z.strictObject({
    object: z.string().optional(),
    recordId: z.uuid().optional(),
    /** Only changes to this field. */
    field: z.string().optional(),
    actorId: z.uuid().optional(),
    runId: z.uuid().optional(),
    ...range,
    ...page,
  }),
  output: pageOf(changeEntrySchema),
  handler: (ctx, { cursor, limit, ...filter }) =>
    ctx.dal.changes(filter, { cursor, limit }),
});

export const auditLogGet = defineQuery({
  name: "auditLog.get",
  description:
    "One change: the fields before and after, the record it belongs to, the run and step that wrote it, and who made it.",
  input: z.strictObject({ id: z.uuid() }),
  output: z.object({ change: changeEntrySchema }),
  handler: async (ctx, { id }) => {
    const change = await ctx.dal.changeGet(id);
    if (!change) {
      return ctx.notFound("change", id);
    }
    return { change };
  },
});

export const eventLogList = defineQuery({
  name: "eventLog.list",
  description:
    "Events runs emitted, newest first, with their payloads. Filter by type, type prefix or run.",
  input: z.strictObject({
    type: z.string().optional(),
    /** A type prefix, as `contact.` for every contact event. */
    typePrefix: z.string().optional(),
    runId: z.uuid().optional(),
    ...range,
    ...page,
  }),
  output: pageOf(eventEntrySchema),
  handler: (ctx, { cursor, limit, ...filter }) =>
    ctx.dal.events(filter, { cursor, limit }),
});

export const eventLogGet = defineQuery({
  name: "eventLog.get",
  description:
    "One event: its type, payload, the run and step that emitted it, and whether it has been dispatched.",
  input: z.strictObject({ id: z.uuid() }),
  output: z.object({ event: eventEntrySchema }),
  handler: async (ctx, { id }) => {
    const event = await ctx.dal.eventGet(id);
    if (!event) {
      return ctx.notFound("event", id);
    }
    return { event };
  },
});

/** Every log query, for defineSystem to register. */
export const logQueries = [
  runList,
  runGet,
  runNeedsAttention,
  auditLogList,
  auditLogGet,
  eventLogList,
  eventLogGet,
] as const;
