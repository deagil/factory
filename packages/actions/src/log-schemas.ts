// Output schemas for the log queries. They live apart from the
// queries because they need the core's action statuses, and files that
// define handlers may not import @workspace/db (decision 0019).
import { actionStatuses } from "@workspace/db/schema";
import { z } from "zod";

export { actionStatuses } from "@workspace/db/schema";

export const timestamp = z.iso.datetime({ offset: true });

const actorSummary = z.object({
  id: z.uuid(),
  name: z.string(),
  kind: z.string(),
});

const userSummary = z.object({ id: z.string(), name: z.string() }).nullable();

const changes = z.record(z.string(), z.unknown());

export const actionLogEntrySchema = z.object({
  id: z.uuid(),
  name: z.string(),
  status: z.enum(actionStatuses),
  dryRun: z.boolean(),
  at: timestamp,
  completedAt: timestamp.nullable(),
  actor: actorSummary,
  /** The person at the start of the chain; null for integrations. */
  origin: userSummary,
  error: z.unknown(),
});

export const changeEntrySchema = z.object({
  id: z.uuid(),
  at: timestamp,
  object: z.string(),
  recordId: z.uuid(),
  action: z.string(),
  actionId: z.uuid(),
  actor: actorSummary,
  origin: userSummary,
  before: changes,
  after: changes,
});

export const eventEntrySchema = z.object({
  id: z.uuid(),
  type: z.string(),
  at: timestamp,
  actionId: z.uuid(),
  depth: z.number().int(),
  dispatchedAt: timestamp.nullable(),
  origin: userSummary,
  payload: z.unknown(),
});

export const actionLogDetailSchema = actionLogEntrySchema.extend({
  input: z.unknown(),
  result: z.unknown(),
  retryKey: z.string().nullable(),
  configSha: z.string().nullable(),
  runId: z.uuid().nullable(),
  changes: z.array(changeEntrySchema),
  events: z.array(eventEntrySchema),
});

export const page = {
  /** The `nextCursor` of the page before. */
  cursor: z.string().optional(),
  limit: z.number().int().min(1).max(200).optional(),
};

export const range = {
  since: timestamp.optional(),
  until: timestamp.optional(),
};

export const pageOf = <TEntry extends z.ZodType>(entry: TEntry) =>
  z.object({ entries: z.array(entry), nextCursor: z.string().nullable() });

export type ActionLogEntry = z.infer<typeof actionLogEntrySchema>;
export type ActionLogDetail = z.infer<typeof actionLogDetailSchema>;
export type ChangeEntry = z.infer<typeof changeEntrySchema>;
export type EventEntry = z.infer<typeof eventEntrySchema>;
