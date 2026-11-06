// Seed fixtures, test database helpers and, from phase 1, generated contract
// tests. See docs/SYSTEM_DESIGN.md, section 6. Delivery.
//
// Tools that run outside Vitest import "@workspace/testing/databases", which
// doesn't load Vitest.
export {
  adminUrl,
  coreMigrationsFolder,
  createDatabaseFromTemplate,
  databaseUrl,
  dropDatabase,
  ensureTemplateDatabase,
  listDatabases,
  migrationsHash,
  templatePrefix,
  testDatabasePrefix,
  withAdmin,
} from "./databases.ts";
export { createTestDatabase } from "./test-database.ts";
export type { TestDatabase } from "./test-database.ts";
