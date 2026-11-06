// Core tables: the same in every instance. Columns follow
// docs/SYSTEM_DESIGN.md section 3. Approval, workflow, config and draft tables
// arrive with the phases that use them.
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
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

const id = () =>
  uuid("id")
    .primaryKey()
    .default(sql`uuidv7()`);
const timestamptz = (name: string) => timestamp(name, { withTimezone: true });
const createdAt = () => timestamptz("created_at").notNull().defaultNow();

// Who can act

export const userStatuses = ["active", "disabled"] as const;

/** People who sign in. Better Auth keeps its own tables (P1.10). */
export const users = pgTable(
  "users",
  {
    id: id(),
    name: text("name").notNull(),
    email: text("email").notNull(),
    status: text("status", { enum: userStatuses }).notNull().default("active"),
    createdAt: createdAt(),
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
] as const;

/** Every action run: who, for whom, input, result, config version. */
export const actionLog = pgTable(
  "action_log",
  {
    id: id(),
    name: text("name").notNull(),
    actorId: uuid("actor_id")
      .notNull()
      .references(() => actors.id),
    originUserId: uuid("origin_user_id").references(() => users.id),
    // References workflow_runs once that table exists (phase 2).
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
  ]
);

/** Every field change to every record, written by repositories. */
export const auditLog = pgTable(
  "audit_log",
  {
    id: id(),
    object: text("object").notNull(),
    recordId: uuid("record_id").notNull(),
    field: text("field").notNull(),
    oldValue: jsonb("old_value"),
    newValue: jsonb("new_value"),
    actionId: uuid("action_id")
      .notNull()
      .references(() => actionLog.id),
    actorId: uuid("actor_id")
      .notNull()
      .references(() => actors.id),
    at: timestamptz("at").notNull().defaultNow(),
  },
  (t) => [
    index("audit_log_record_idx").on(t.object, t.recordId, t.at),
    index("audit_log_action_id_idx").on(t.actionId),
  ]
);

/** Every event, written by actions in the same transaction as the change. */
export const eventLog = pgTable(
  "event_log",
  {
    id: id(),
    type: text("type").notNull(),
    payload: jsonb("payload").notNull(),
    actionId: uuid("action_id")
      .notNull()
      .references(() => actionLog.id),
    originUserId: uuid("origin_user_id").references(() => users.id),
    depth: integer("depth").notNull().default(0),
    createdAt: createdAt(),
    dispatchedAt: timestamptz("dispatched_at"),
  },
  (t) => [
    index("event_log_action_id_idx").on(t.actionId),
    index("event_log_undispatched_idx")
      .on(t.createdAt)
      .where(sql`${t.dispatchedAt} is null`),
  ]
);
