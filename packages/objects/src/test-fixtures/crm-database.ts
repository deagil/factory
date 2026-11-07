// A test database with the fixture CRM's tables: drizzle-kit generates their
// migration from crm-schema.ts, against a copy of the core migrations, and
// the result is applied to a fresh test database.

import { spawnSync } from "node:child_process";
import {
  cpSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import {
  actors,
  closeDb,
  createDb,
  migrationsFolder,
  users,
} from "@workspace/db";
import type { Db } from "@workspace/db";
import { createTestDatabase } from "@workspace/testing";
import { migrate } from "drizzle-orm/node-postgres/migrator";

const packageDir = path.resolve(import.meta.dirname, "../..");
const coreSchema = path.resolve(packageDir, "../db/src/schema/core.ts");
const fixtureSchema = path.resolve(import.meta.dirname, "crm-schema.ts");

/**
 * Runs drizzle-kit generate for the core tables and the fixture objects into
 * `out`, which starts as a copy of the core migrations, and returns the new
 * migration. drizzle-kit mangles absolute paths, and repeated `--schema`
 * flags don't add up, so it gets a config with paths relative to the package.
 */
const generate = (out: string): string => {
  cpSync(migrationsFolder, out, { recursive: true });
  const relative = (to: string) => path.relative(packageDir, to);
  const config = path.join(out, "drizzle.config.mjs");
  writeFileSync(
    config,
    `export default ${JSON.stringify({
      dialect: "postgresql",
      schema: [relative(coreSchema), relative(fixtureSchema)],
      out: relative(out),
      schemaFilter: ["public", "auth"],
    })};\n`
  );
  const result = spawnSync(
    "pnpm",
    [
      "exec",
      "drizzle-kit",
      "generate",
      "--config",
      relative(config),
      "--name",
      "crm",
    ],
    { cwd: packageDir, encoding: "utf-8", stdio: ["ignore", "pipe", "pipe"] }
  );
  const sqlFile = readdirSync(out).find((name) => name.endsWith("_crm.sql"));
  if (!sqlFile) {
    throw new Error(
      `drizzle-kit generated no migration:\n${result.stdout}${result.stderr}`
    );
  }
  return readFileSync(path.join(out, sqlFile), "utf-8");
};

export interface CrmDatabase {
  readonly db: Db;
  /** The SQL drizzle-kit generated for the fixture objects. */
  readonly migration: string;
  /** Closes the pool and drops the database. Call it in `afterAll`. */
  readonly close: () => Promise<void>;
}

/** A fresh test database with the core and fixture CRM tables. */
export const createCrmDatabase = async (): Promise<CrmDatabase> => {
  const out = mkdtempSync(path.join(tmpdir(), "objects-crm-"));
  try {
    const migration = generate(out);
    const database = await createTestDatabase();
    const db = createDb(database.url);
    try {
      await migrate(db, { migrationsFolder: out });
    } catch (error) {
      await closeDb(db);
      await database.drop();
      throw error;
    }
    return {
      db,
      migration,
      close: async () => {
        await closeDb(db);
        await database.drop();
      },
    };
  } finally {
    rmSync(out, { recursive: true, force: true });
  }
};

/** A user and their staff actor, for `created_by` and actor refs. */
export const createStaffActor = async (db: Db, name = "Sarah") => {
  const [user] = await db
    .insert(users)
    .values({ name, email: `${name.toLowerCase()}@example.com` })
    .returning();
  const [actor] = await db
    .insert(actors)
    .values({ kind: "staff", name, userId: user?.id })
    .returning();
  if (!actor) {
    throw new Error("insert returned no actor");
  }
  return actor;
};
