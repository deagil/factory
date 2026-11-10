// Core tables: the same in every instance. Columns follow
// docs/SYSTEM_DESIGN.md section 3. Workflow tables arrive with the phase
// that uses them.
//
// Status and kind columns are text with TypeScript enums, not database
// enums or check constraints, so adding a value later is not a destructive
// migration. Only the action pipeline writes these tables.

import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  index,
  integer,
  jsonb,
  pgSchema,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import type { AnyPgColumn } from "drizzle-orm/pg-core";

const id = () =>
  uuid("id")
    .primaryKey()
    .default(sql`uuidv7()`);
const timestamptz = (name: string) => timestamp(name, { withTimezone: true });
const createdAt = () => timestamptz("created_at").notNull().defaultNow();

// Who can act

export const userStatuses = ["active", "disabled"] as const;

/**
 * People who sign in. This is Better Auth's user table (decision 0023);
 * its sessions, accounts and codes are in the `auth` schema below.
 */
export const users = pgTable(
  "users",
  {
    id: id(),
    name: text("name").notNull(),
    email: text("email").notNull(),
    status: text("status", { enum: userStatuses }).notNull().default("active"),
    emailVerified: boolean("email_verified").notNull().default(false),
    image: text("image"),
    createdAt: createdAt(),
    updatedAt: timestamptz("updated_at").notNull().defaultNow(),
  },
  (t) => [uniqueIndex("users_email_unique").on(sql`lower(${t.email})`)]
);

export const actorKinds = [
  "staff",
  "agent",
  "integration",
  "automation",
] as const;
export const actorStatuses = ["active", "disabled"] as const;

/** Whoever performs an action. Staff and agents always belong to a user. */
export const actors = pgTable(
  "actors",
  {
    id: id(),
    kind: text("kind", { enum: actorKinds }).notNull(),
    name: text("name").notNull(),
    userId: uuid("user_id").references(() => users.id),
    status: text("status", { enum: actorStatuses }).notNull().default("active"),
    createdAt: createdAt(),
  },
  (t) => [
    index("actors_user_id_idx").on(t.userId),
    // A user has one staff actor, found or created when they sign in.
    uniqueIndex("actors_staff_user_unique")
      .on(t.userId)
      .where(sql`${t.kind} = 'staff'`),
    // Each workflow runs as one automation, named for it (P2.17).
    uniqueIndex("actors_automation_name_unique")
      .on(t.name)
      .where(sql`${t.kind} = 'automation'`),
    check(
      "actors_user_required",
      sql`${t.kind} not in ('staff', 'agent') or ${t.userId} is not null`
    ),
  ]
);

/** Links actors to roles. Roles themselves are defined in config. */
export const actorRoles = pgTable(
  "actor_roles",
  {
    actorId: uuid("actor_id")
      .notNull()
      .references(() => actors.id),
    roleKey: text("role_key").notNull(),
  },
  (t) => [primaryKey({ columns: [t.actorId, t.roleKey] })]
);

/** Keys for agents and integrations. Only the hash is stored. */
export const apiKeys = pgTable(
  "api_keys",
  {
    id: id(),
    actorId: uuid("actor_id")
      .notNull()
      .references(() => actors.id),
    keyHash: text("key_hash").notNull().unique(),
    label: text("label").notNull(),
    lastUsedAt: timestamptz("last_used_at"),
    revokedAt: timestamptz("revoked_at"),
    createdAt: createdAt(),
  },
  (t) => [index("api_keys_actor_id_idx").on(t.actorId)]
);

// What happened

export const actionStatuses = [
  "pending_approval",
  "succeeded",
  "failed",
  "rejected",
  "withdrawn",
] as const;

/**
 * Phase 1's log of action calls. Runs replaced it (P2.12, decision 0046):
 * nothing writes it any more, and dropping it is the contract step in P2.26.
 */
export const actionLog = pgTable(
  "action_log",
  {
    id: id(),
    name: text("name").notNull(),
    actorId: uuid("actor_id")
      .notNull()
      .references(() => actors.id),
    originUserId: uuid("origin_user_id").references(() => users.id),
    runId: uuid("run_id"),
    input: jsonb("input").notNull(),
    result: jsonb("result"),
    error: jsonb("error"),
    status: text("status", { enum: actionStatuses }).notNull(),
    retryKey: text("retry_key"),
    dryRun: boolean("dry_run").notNull().default(false),
    configSha: text("config_sha"),
    createdAt: createdAt(),
    completedAt: timestamptz("completed_at"),
  },
  (t) => [
    index("action_log_actor_id_created_at_idx").on(t.actorId, t.createdAt),
    index("action_log_run_id_idx").on(t.runId),
    uniqueIndex("action_log_retry_key_unique")
      .on(t.actorId, t.retryKey)
      .where(
        sql`${t.retryKey} is not null and ${t.status} = 'succeeded' and not ${t.dryRun}`
      ),
  ]
);

/**
 * What a run can be. `running` between and during segments, `waiting` at a
 * pause; `needs_attention` when a step failed after a commit and nothing
 * undid it, until someone retries it, runs its failure steps or marks it
 * `resolved` (P2.20).
 */
export const runStatuses = [
  "running",
  "waiting",
  "succeeded",
  "failed",
  "needs_attention",
  "resolved",
  "rejected",
  "withdrawn",
  "cancelled",
] as const;

/**
 * Every call of an endpoint (decision 0046): who called it, for whom, its
 * input, its output or error, and the config it ran under. A successful run
 * is written in its transaction with what it changed; a failed one is
 * written after the rollback, so its trace survives. Only the engine (the
 * pipeline) writes it.
 */
export const runs = pgTable(
  "runs",
  {
    id: id(),
    /** The endpoint called, or for now the action or query by name. */
    endpoint: text("endpoint").notNull(),
    actorId: uuid("actor_id")
      .notNull()
      .references(() => actors.id),
    originUserId: uuid("origin_user_id").references(() => users.id),
    input: jsonb("input").notNull(),
    output: jsonb("output"),
    error: jsonb("error"),
    status: text("status", { enum: runStatuses }).notNull(),
    retryKey: text("retry_key"),
    dryRun: boolean("dry_run").notNull().default(false),
    configSha: text("config_sha"),
    parentRunId: uuid("parent_run_id").references((): AnyPgColumn => runs.id),
    /** The event that started it, for runs a workflow's trigger started. */
    eventId: uuid("event_id"),
    /** The minute a schedule started it for (P2.19). */
    scheduledFor: timestamptz("scheduled_for"),
    depth: integer("depth").notNull().default(0),
    /** The role whose inbox gets it while it needs attention (P2.20). */
    attentionRole: text("attention_role"),
    /**
     * Where a run that pauses has got to, written with each segment it
     * commits: what a restart, a retry or its failure steps go on from.
     */
    checkpoint: jsonb("checkpoint"),
    startedAt: timestamptz("started_at").notNull().defaultNow(),
    finishedAt: timestamptz("finished_at"),
  },
  (t) => [
    index("runs_actor_id_started_at_idx").on(t.actorId, t.startedAt),
    index("runs_started_at_idx").on(t.startedAt),
    index("runs_parent_run_id_idx").on(t.parentRunId),
    // One success per retry key and actor: a second run with the key waits
    // on this index, then replays the first's result (decision 0021).
    uniqueIndex("runs_retry_key_unique")
      .on(t.actorId, t.retryKey)
      .where(
        sql`${t.retryKey} is not null and ${t.status} = 'succeeded' and not ${t.dryRun}`
      ),
    // An event starts each workflow once, and a schedule once a minute,
    // however many dispatchers run (P2.19).
    uniqueIndex("runs_event_unique")
      .on(t.endpoint, t.eventId)
      .where(sql`${t.eventId} is not null`),
    uniqueIndex("runs_schedule_unique")
      .on(t.endpoint, t.scheduledFor)
      .where(sql`${t.scheduledFor} is not null`),
    // A role's inbox of runs that need attention.
    index("runs_attention_idx")
      .on(t.attentionRole)
      .where(sql`${t.status} = 'needs_attention'`),
  ]
);

export const runStepKinds = ["action", "control"] as const;

/**
 * One row per step of a run (decision 0046). `step_id` is the step's id in
 * its workflow; a one-step run of an action uses the action's name. `name`
 * is the action a step ran, or the control step (`if`, `emit`, …).
 * `segment` numbers the transactions a run commits in. A retried step
 * gets a new row with the next `attempt`. Only the engine writes it.
 */
export const runSteps = pgTable(
  "run_steps",
  {
    id: id(),
    runId: uuid("run_id")
      .notNull()
      .references(() => runs.id),
    stepId: text("step_id").notNull(),
    kind: text("kind", { enum: runStepKinds }).notNull(),
    name: text("name").notNull(),
    segment: integer("segment").notNull().default(0),
    input: jsonb("input"),
    output: jsonb("output"),
    error: jsonb("error"),
    /** For an `if` step: `then` or `else`. */
    branch: text("branch"),
    attempt: integer("attempt").notNull().default(1),
    startedAt: timestamptz("started_at").notNull().defaultNow(),
    finishedAt: timestamptz("finished_at"),
  },
  (t) => [index("run_steps_run_id_idx").on(t.runId, t.startedAt)]
);

/**
 * Every change to every record, written by repositories: one row per record
 * per step. `before` and `after` hold only the fields that changed, by
 * key, with custom fields as `customFields.<key>`. A create has an empty
 * `before`. See decision 0018.
 */
export const auditLog = pgTable(
  "audit_log",
  {
    id: id(),
    object: text("object").notNull(),
    recordId: uuid("record_id").notNull(),
    before: jsonb("before")
      .$type<Record<string, unknown>>()
      .notNull()
      .default({}),
    after: jsonb("after")
      .$type<Record<string, unknown>>()
      .notNull()
      .default({}),
    /** Phase 1's action_log row; null from P2.12 on. */
    actionId: uuid("action_id").references(() => actionLog.id),
    /** The run and step that made the change; null only before P2.12. */
    runId: uuid("run_id").references(() => runs.id),
    stepId: uuid("step_id").references(() => runSteps.id),
    actorId: uuid("actor_id")
      .notNull()
      .references(() => actors.id),
    at: timestamptz("at").notNull().defaultNow(),
  },
  (t) => [
    index("audit_log_record_idx").on(t.object, t.recordId, t.at),
    index("audit_log_action_id_idx").on(t.actionId),
    index("audit_log_run_id_idx").on(t.runId),
    // Finds every change to one field across records: `after ? 'stage'`.
    index("audit_log_after_idx").using("gin", t.after),
  ]
);

/** Every event, written in the same transaction as the change. */
export const eventLog = pgTable(
  "event_log",
  {
    id: id(),
    type: text("type").notNull(),
    payload: jsonb("payload").notNull(),
    /** Phase 1's action_log row; null from P2.12 on. */
    actionId: uuid("action_id").references(() => actionLog.id),
    /** The run and step that emitted it; null only before P2.12. */
    runId: uuid("run_id").references(() => runs.id),
    stepId: uuid("step_id").references(() => runSteps.id),
    originUserId: uuid("origin_user_id").references(() => users.id),
    depth: integer("depth").notNull().default(0),
    createdAt: createdAt(),
    dispatchedAt: timestamptz("dispatched_at"),
  },
  (t) => [
    index("event_log_action_id_idx").on(t.actionId),
    index("event_log_run_id_idx").on(t.runId),
    index("event_log_undispatched_idx")
      .on(t.createdAt)
      .where(sql`${t.dispatchedAt} is null`),
  ]
);

// Config (SYSTEM_DESIGN §4.4)

export const configVersionStatuses = ["loaded", "refused"] as const;

/**
 * Each version of `config/` the loader tried (P2.05): the commit, or locally
 * a hash of the working tree; whether it went live; and, if it was refused,
 * the problems. Only the config loader writes it.
 */
export const configVersions = pgTable(
  "config_versions",
  {
    id: id(),
    sha: text("sha").notNull(),
    status: text("status", { enum: configVersionStatuses }).notNull(),
    errors: jsonb("errors"),
    loadedAt: timestamptz("loaded_at").notNull().defaultNow(),
  },
  (t) => [index("config_versions_loaded_at_idx").on(t.loadedAt)]
);

export const draftStatuses = [
  "draft",
  "valid",
  "invalid",
  "awaiting_approval",
  "published",
  "abandoned",
] as const;

/**
 * Staff edits to config (P2.08): a branch in the config remote, made from
 * production, with one commit per saved file. `files` are the config files
 * the draft changes; `base_sha` is the production commit it began from.
 * Publishing writes one commit to production (`published_sha`) and copies it
 * to main (`synced_sha`). A draft opened by a save has `auto_title`, written
 * from its files on each save. One waiting for approval has its parked
 * `draft.publish` run in `publish_run_id`, which the last approval resumes
 * (decision 0044); `publish_action_id` is phase 1's, unused since P2.12.
 * `head_sha` is the branch's latest commit, set on each save and revert, so a
 * page can tell that the draft moved without reading the files (decision
 * 0055). Only the draft and approval actions write it.
 */
export const drafts = pgTable(
  "drafts",
  {
    id: id(),
    branch: text("branch").notNull(),
    title: text("title").notNull(),
    autoTitle: boolean("auto_title").notNull().default(false),
    files: text("files")
      .array()
      .notNull()
      .default(sql`'{}'::text[]`),
    status: text("status", { enum: draftStatuses }).notNull(),
    baseSha: text("base_sha").notNull(),
    /** The draft branch's latest commit; null until the first save. */
    headSha: text("head_sha"),
    publishedSha: text("published_sha"),
    syncedSha: text("synced_sha"),
    publishActionId: uuid("publish_action_id").references(() => actionLog.id),
    publishRunId: uuid("publish_run_id").references(() => runs.id),
    createdBy: uuid("created_by")
      .notNull()
      .references(() => actors.id),
    createdAt: createdAt(),
    publishedAt: timestamptz("published_at"),
  },
  (t) => [
    uniqueIndex("drafts_branch_unique").on(t.branch),
    index("drafts_status_idx").on(t.status),
    index("drafts_created_by_idx").on(t.createdBy, t.status),
  ]
);

/** `run` is a run waiting for approval; `action` was phase 1's. */
export const approvalSubjects = ["run", "draft", "action"] as const;
export const approvalStatuses = [
  "pending",
  "approved",
  "rejected",
  "cancelled",
] as const;

/**
 * Sign-offs an approval rule asked for (P2.09, decision 0042): one row per
 * rule that matched an action (its waiting run) or covers a
 * draft. `approver_role` is copied from the rule, so a later edit to the
 * rule doesn't change who may decide. A save to a draft cancels its rows.
 * Only the pipeline and the approval and draft actions write it.
 */
export const approvals = pgTable(
  "approvals",
  {
    id: id(),
    subject: text("subject", { enum: approvalSubjects }).notNull(),
    subjectId: uuid("subject_id").notNull(),
    ruleKey: text("rule_key").notNull(),
    approverRole: text("approver_role").notNull(),
    status: text("status", { enum: approvalStatuses }).notNull(),
    requestedBy: uuid("requested_by")
      .notNull()
      .references(() => actors.id),
    decidedBy: uuid("decided_by").references(() => actors.id),
    comment: text("comment"),
    createdAt: createdAt(),
    decidedAt: timestamptz("decided_at"),
  },
  (t) => [
    index("approvals_subject_idx").on(t.subject, t.subjectId),
    index("approvals_status_idx").on(t.status, t.createdAt),
  ]
);

// Better Auth's own tables, in their own schema. Only Better Auth writes them.

export const authSchema = pgSchema("auth");

const authTimestamps = () => ({
  createdAt: createdAt(),
  updatedAt: timestamptz("updated_at").notNull().defaultNow(),
});

/** Signed-in sessions. */
export const sessions = authSchema.table(
  "sessions",
  {
    id: id(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    token: text("token").notNull().unique(),
    expiresAt: timestamptz("expires_at").notNull(),
    ipAddress: text("ip_address"),
    userAgent: text("user_agent"),
    ...authTimestamps(),
  },
  (t) => [index("sessions_user_id_idx").on(t.userId)]
);

/** Ways a user signs in: SSO providers (phase 3), and the email code. */
export const accounts = authSchema.table(
  "accounts",
  {
    id: id(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    accountId: text("account_id").notNull(),
    providerId: text("provider_id").notNull(),
    accessToken: text("access_token"),
    refreshToken: text("refresh_token"),
    idToken: text("id_token"),
    accessTokenExpiresAt: timestamptz("access_token_expires_at"),
    refreshTokenExpiresAt: timestamptz("refresh_token_expires_at"),
    scope: text("scope"),
    password: text("password"),
    ...authTimestamps(),
  },
  (t) => [index("accounts_user_id_idx").on(t.userId)]
);

/** Sign-in codes waiting to be used. */
export const verifications = authSchema.table(
  "verifications",
  {
    // Better Auth chooses these ids itself, and they aren't uuids.
    id: text("id")
      .primaryKey()
      .default(sql`uuidv7()::text`),
    identifier: text("identifier").notNull(),
    value: text("value").notNull(),
    expiresAt: timestamptz("expires_at").notNull(),
    ...authTimestamps(),
  },
  (t) => [index("verifications_identifier_idx").on(t.identifier)]
);
