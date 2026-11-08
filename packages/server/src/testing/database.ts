// A test database built the way a deployed system's is: the core's
// migrations, then the system's own (decision 0036).
import { closeDb, createDb, runSystemMigrations } from "@workspace/db";
import type { Db } from "@workspace/db";
import { createTestDatabase } from "@workspace/testing";

import type { System } from "../system.ts";

export interface SystemDatabase {
  readonly db: Db;
  /** Its connection string, for code that makes its own pool. */
  readonly url: string;
  /** Closes the pool and drops the database. Call it in `afterAll`. */
  readonly close: () => Promise<void>;
}

/** A fresh test database with the core's migrations and `system`'s applied. */
export const createSystemDatabase = async (
  system: System
): Promise<SystemDatabase> => {
  if (!system.migrations) {
    throw new Error(
      `${system.name} has no migrations folder; pass \`migrations\` to defineSystem.`
    );
  }
  const database = await createTestDatabase();
  try {
    await runSystemMigrations(database.url, system.migrations);
  } catch (error) {
    await database.drop();
    throw error;
  }
  const db = createDb(database.url);
  return {
    db,
    url: database.url,
    close: async () => {
      await closeDb(db);
      await database.drop();
    },
  };
};
