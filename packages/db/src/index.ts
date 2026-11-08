// Drizzle setup, core tables, migration runner and, from phase 1, the schema
// check that compares the database with the object definitions.
// See docs/SYSTEM_DESIGN.md, section 3. Starting database schema.
export { closeDb, createDb, withTransaction } from "./client.ts";
export type { Db, Executor, Schema, Tx } from "./client.ts";
export { loadEnv, redactUrl, requireEnv, rootEnvFile } from "./env.ts";
export {
  activeUsers,
  actorForApiKey,
  apiKeyPrefix,
  bootstrapStaff,
  createIdentityStore,
  hashApiKey,
  isActiveUser,
  staffActorFor,
} from "./identity.ts";
export type { IdentityStore } from "./identity.ts";
export {
  migrationsFolder,
  runMigrations,
  runSystemMigrations,
  systemMigrationsTable,
} from "./migrate.ts";
export type { MigrateOptions } from "./migrate.ts";
export {
  contractMarker,
  isContractStep,
  lintMigration,
  splitStatements,
} from "./migration-lint.ts";
export type { MigrationFinding } from "./migration-lint.ts";
export { ascNullsLast, descNullsLast, jsonbHasKey } from "./ordering.ts";
export {
  assertSchema,
  checkSchema,
  coreTables,
  formatSchemaProblems,
  normaliseType,
  SchemaCheckError,
} from "./schema-check.ts";
export type { SchemaCheckResult, SchemaProblem } from "./schema-check.ts";
export {
  accounts,
  actionLog,
  actionStatuses,
  actorKinds,
  actorRoles,
  actors,
  actorStatuses,
  apiKeys,
  approvals,
  approvalStatuses,
  approvalSubjects,
  auditLog,
  configVersions,
  configVersionStatuses,
  drafts,
  draftStatuses,
  authSchema,
  eventLog,
  sessions,
  users,
  userStatuses,
  verifications,
} from "./schema/core.ts";
export { listConfigVersions, recordConfigVersion } from "./config-versions.ts";
export { createApprovalStore } from "./approvals.ts";
export type {
  ApprovalRequest,
  ApprovalRow,
  ApprovalStatus,
  ApprovalStore,
  ApprovalSubject,
} from "./approvals.ts";
export { createDraftStore } from "./drafts.ts";
export type { DraftChanges, DraftStatus, DraftStore } from "./drafts.ts";
export type {
  ConfigVersionRow,
  ConfigVersionStatus,
} from "./config-versions.ts";
