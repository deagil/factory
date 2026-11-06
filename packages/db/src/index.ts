// Drizzle setup, core tables, migration runner and, from phase 1, the schema
// check that compares the database with the object definitions.
// See docs/SYSTEM_DESIGN.md, section 3. Starting database schema.
export { closeDb, createDb, withTransaction } from "./client.ts";
export type { Db, Executor, Schema, Tx } from "./client.ts";
export { loadEnv, redactUrl, requireEnv, rootEnvFile } from "./env.ts";
export { migrationsFolder, runMigrations } from "./migrate.ts";
export {
  actionLog,
  actionStatuses,
  actorKinds,
  actorRoles,
  actors,
  actorStatuses,
  apiKeys,
  auditLog,
  eventLog,
  users,
  userStatuses,
} from "./schema/core.ts";
