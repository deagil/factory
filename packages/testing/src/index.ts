// Seed fixtures, test database helpers and, from phase 1, generated contract
// tests. See docs/SYSTEM_DESIGN.md, section 6. Delivery.
export {
  coreMigrationsFolder,
  createDatabaseFromTemplate,
  createTestDatabase,
  databaseUrl,
  dropDatabase,
  ensureTemplateDatabase,
  listDatabases,
  migrationsHash,
  templatePrefix,
  testDatabasePrefix,
  withAdmin,
} from "./database.ts";
export type { TestDatabase } from "./database.ts";
