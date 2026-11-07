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
  pgSchema,
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
    // One success per retry key and actor: a second run with the key waits
    // on this index, then replays the first's result (decision 0021).
    uniqueIndex("action_log_retry_key_unique")
      .on(t.actorId, t.retryKey)
      .where(
        sql`${t.retryKey} is not null and ${t.status} = 'succeeded' and not ${t.dryRun}`
      ),
  ]
);

/**
 * Every change to every record, written by repositories: one row per record
 * per action. `before` and `after` hold only the fields that changed, by
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
    // Finds every change to one field across records: `after ? 'stage'`.
    index("audit_log_after_idx").using("gin", t.after),
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
