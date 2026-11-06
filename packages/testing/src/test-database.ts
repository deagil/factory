// Test databases: one fresh database per test file, cloned from a migrated
// template. Tests never touch the dev database.

import { randomBytes } from "node:crypto";

import { inject } from "vitest";

import {
  adminUrl,
  coreMigrationsFolder,
  createDatabaseFromTemplate,
  databaseUrl,
  dropDatabase,
  ensureTemplateDatabase,
  testDatabasePrefix,
  withAdmin,
} from "./databases.ts";

const randomSuffix = (): string => randomBytes(4).toString("hex");

/** A fresh, migrated database for one test file. */
export interface TestDatabase {
  /** The database name, unique to this test file. */
  readonly name: string;
  /** A connection URL for the database. */
  readonly url: string;
  /** Drops the database. Call it in `afterAll`. */
  readonly drop: () => Promise<void>;
}

const runId = (): string => {
  try {
    return inject("testDatabaseRunId");
  } catch {
    // Outside the shared Vitest config there is no run ID; make one.
    return randomSuffix();
  }
};

/**
 * Creates a fresh database for this test file from the migrated template.
 * Close your own connections, then call `drop()` in `afterAll`; the shared
 * Vitest config also drops anything a crashed file left behind.
 */
export const createTestDatabase = async (): Promise<TestDatabase> => {
  const url = adminUrl();
  const template = await ensureTemplateDatabase(coreMigrationsFolder, url);
  const name = `${testDatabasePrefix}${runId()}_${randomSuffix()}`;
  await withAdmin(
    (client) => createDatabaseFromTemplate(client, name, template),
    url
  );
  return {
    name,
    url: databaseUrl(url, name),
    drop: () => withAdmin((client) => dropDatabase(client, name), url),
  };
};

declare module "vitest" {
  interface ProvidedContext {
    testDatabaseRunId: string;
  }
}
