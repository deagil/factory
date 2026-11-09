// Output schemas for the log queries (P1b.02). They live apart from the
// queries because they need the core's run statuses, and files that
// define handlers may not import @workspace/db (decision 0019).
import { runStatuses, runStepKinds } from "@workspace/db/schema";
import { z } from "zod";

export { runStatuses } from "@workspace/db/schema";

export const timestamp = z.iso.datetime({ offset: true });

const actorSummary = z.object({
  id: z.uuid(),
  name: z.string(),
  kind: z.string(),
});

const userSummary = z.object({ id: z.string(), name: z.string() }).nullable();

const changes = z.record(z.string(), z.unknown());

export const runEntrySchema = z.object({
  id: z.uuid(),
  /** The endpoint called; for now an action or query by name. */
  endpoint: z.string(),
  status: z.enum(runStatuses),
  dryRun: z.boolean(),
  at: timestamp,
  finishedAt: timestamp.nullable(),
  actor: actorSummary,
  /** The person at the start of the chain; null for integrations. */
  origin: userSummary,
  error: z.unknown(),
  /** The role whose inbox gets it while it needs attention (P2.20). */
  attentionRole: z.string().nullable(),
});

export const changeEntrySchema = z.object({
  id: z.uuid(),
  at: timestamp,
  object: z.string(),
  recordId: z.uuid(),
  action: z.string(),
  runId: z.uuid(),
  stepId: z.uuid(),
  actor: actorSummary,
  origin: userSummary,
  before: changes,
  after: changes,
});

export const eventEntrySchema = z.object({
  id: z.uuid(),
  type: z.string(),
  at: timestamp,
  runId: z.uuid().nullable(),
  stepId: z.uuid().nullable(),
  depth: z.number().int(),
  dispatchedAt: timestamp.nullable(),
  origin: userSummary,
  payload: z.unknown(),
});

export const runStepEntrySchema = z.object({
  id: z.uuid(),
  /** The step's id in its workflow; a one-step run uses the action's name. */
  stepId: z.string(),
  kind: z.enum(runStepKinds),
  /** The action the step ran, or the control step. */
  name: z.string(),
  segment: z.number().int(),
  attempt: z.number().int(),
  branch: z.string().nullable(),
  input: z.unknown(),
  output: z.unknown(),
  error: z.unknown(),
  at: timestamp,
  finishedAt: timestamp.nullable(),
});

export const runDetailSchema = runEntrySchema.extend({
  input: z.unknown(),
  output: z.unknown(),
  retryKey: z.string().nullable(),
  configSha: z.string().nullable(),
  parentRunId: z.uuid().nullable(),
  steps: z.array(runStepEntrySchema),
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

export type RunEntry = z.infer<typeof runEntrySchema>;
export type RunDetail = z.infer<typeof runDetailSchema>;
export type RunStepEntry = z.infer<typeof runStepEntrySchema>;
export type ChangeEntry = z.infer<typeof changeEntrySchema>;
export type EventEntry = z.infer<typeof eventEntrySchema>;
