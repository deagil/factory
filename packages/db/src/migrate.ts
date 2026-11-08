import path from "node:path";

import { migrate } from "drizzle-orm/node-postgres/migrator";

import { closeDb, createDb } from "./client.ts";

/** The committed migrations for the core tables. */
export const migrationsFolder = path.resolve(
  import.meta.dirname,
  "../migrations"
);

/**
 * Where a system's applied migrations are recorded. A system's migrations
 * have their own journal, so they need a table of their own next to
 * drizzle's `__drizzle_migrations`, which records the core's (decision 0036).
 */
export const systemMigrationsTable = "__drizzle_migrations_system";

export interface MigrateOptions {
  /** A system's migrations folder, applied after the core's. */
  readonly system?: string | undefined;
}

/**
 * Applies every pending core migration to the database at `url`, then the
 * system's, when a folder is given.
 */
export const runMigrations = async (
  url: string,
  options: MigrateOptions = {}
): Promise<void> => {
  const db = createDb(url, { max: 1 });
  try {
    await migrate(db, { migrationsFolder });
    if (options.system) {
      await migrate(db, {
        migrationsFolder: options.system,
        migrationsTable: systemMigrationsTable,
      });
    }
  } finally {
    await closeDb(db);
  }
};

/** Applies a system's pending migrations to a database that has the core's. */
export const runSystemMigrations = async (
  url: string,
  folder: string
): Promise<void> => {
  const db = createDb(url, { max: 1 });
  try {
    await migrate(db, {
      migrationsFolder: folder,
      migrationsTable: systemMigrationsTable,
    });
  } finally {
    await closeDb(db);
  }
};
