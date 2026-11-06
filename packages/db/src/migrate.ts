import path from "node:path";

import { migrate } from "drizzle-orm/node-postgres/migrator";

import { closeDb, createDb } from "./client.ts";

/** The committed migrations for the core tables. */
export const migrationsFolder = path.resolve(
  import.meta.dirname,
  "../migrations"
);

/** Applies every pending migration to the database at `url`. */
export const runMigrations = async (url: string): Promise<void> => {
  const db = createDb(url, { max: 1 });
  try {
    await migrate(db, { migrationsFolder });
  } finally {
    await closeDb(db);
  }
};
