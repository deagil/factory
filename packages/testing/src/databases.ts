// Database admin helpers: create, clone, list and drop databases, and build
// migrated templates. Used by test databases and by `fx start`. Nothing here
// imports Vitest, so tools can use it.
//
// This package must not depend on other workspace packages (they all
// devDepend on it), so it applies the migration files itself rather than
// importing @workspace/db.

import { createHash, randomBytes } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";

import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { Client } from "pg";

/** The core migrations, by path: see the note at the top of this file. */
export const coreMigrationsFolder = path.resolve(
  import.meta.dirname,
  "../../db/migrations"
);

const prefix = "factory";
export const templatePrefix = `${prefix}_template_`;
export const testDatabasePrefix = `${prefix}_test_`;

export const adminUrl = (): string => {
  const url = process.env.DATABASE_ADMIN_URL;
  if (!url) {
    throw new Error(
      "DATABASE_ADMIN_URL is not set. Copy .env.example to .env at the repo root and run `pnpm db:up`."
    );
  }
  return url;
};

/** The URL of database `name` on the same server as `baseUrl`. */
export const databaseUrl = (baseUrl: string, name: string): string => {
  const url = new URL(baseUrl);
  url.pathname = `/${name}`;
  return url.toString();
};

const quote = (name: string): string => `"${name.replaceAll('"', '""')}"`;

const randomSuffix = (): string => randomBytes(4).toString("hex");

/** Runs `work` with a short-lived connection to the admin database. */
export const withAdmin = async <T>(
  work: (client: Client) => Promise<T>,
  url: string = adminUrl()
): Promise<T> => {
  const client = new Client({ connectionString: url });
  await client.connect();
  try {
    return await work(client);
  } finally {
    await client.end();
  }
};

const databaseExists = async (
  client: Client,
  name: string
): Promise<boolean> => {
  const result = await client.query(
    "select 1 from pg_database where datname = $1",
    [name]
  );
  return result.rowCount === 1;
};

/** Lists databases whose names start with `namePrefix`. */
export const listDatabases = async (
  client: Client,
  namePrefix: string
): Promise<string[]> => {
  const result = await client.query<{ datname: string }>(
    "select datname from pg_database where starts_with(datname, $1) order by datname",
    [namePrefix]
  );
  return result.rows.map((row) => row.datname);
};

/** Drops a database, closing any connections to it first. */
export const dropDatabase = async (
  client: Client,
  name: string
): Promise<void> => {
  await client.query(`drop database if exists ${quote(name)} with (force)`);
};

/** A short hash of every file in a migrations folder. */
export const migrationsHash = (folder: string): string => {
  const hash = createHash("sha256");
  const files = readdirSync(folder, { recursive: true, encoding: "utf-8" })
    .filter((file) => file.endsWith(".sql") || file.endsWith(".json"))
    .toSorted();
  for (const file of files) {
    hash.update(file);
    hash.update(readFileSync(path.join(folder, file)));
  }
  return hash.digest("hex").slice(0, 12);
};

const applyMigrations = async (url: string, folder: string): Promise<void> => {
  const client = new Client({ connectionString: url });
  await client.connect();
  try {
    await migrate(drizzle({ client }), { migrationsFolder: folder });
  } finally {
    await client.end();
  }
};

/**
 * Makes sure a migrated template database exists for the current migrations,
 * and returns its name. The name includes a hash of the migrations, so it is
 * rebuilt when they change. Safe to call from parallel processes: each
 * builder works under its own name and renames it into place.
 *
 * Templates for older migrations are kept, because another worktree or run
 * may still be cloning from them. They are small; `fx done` prunes them.
 */
export const ensureTemplateDatabase = async (
  folder: string = coreMigrationsFolder,
  url: string = adminUrl()
): Promise<string> => {
  const name = `${templatePrefix}${migrationsHash(folder)}`;
  return await withAdmin(async (client) => {
    if (await databaseExists(client, name)) {
      return name;
    }
    const building = `${name}_build_${randomSuffix()}`;
    await client.query(`create database ${quote(building)}`);
    try {
      await applyMigrations(databaseUrl(url, building), folder);
      await client.query(
        `alter database ${quote(building)} rename to ${quote(name)}`
      );
    } catch (error) {
      await dropDatabase(client, building);
      // Another process finished first: use its template.
      if (await databaseExists(client, name)) {
        return name;
      }
      throw error;
    }
    return name;
  }, url);
};

/** Creates an empty database `name`. */
export const createDatabase = async (
  client: Client,
  name: string
): Promise<void> => {
  await client.query(`create database ${quote(name)}`);
};

/** Creates database `name` as a copy of `template`. */
export const createDatabaseFromTemplate = async (
  client: Client,
  name: string,
  template: string
): Promise<void> => {
  await client.query(
    `create database ${quote(name)} template ${quote(template)}`
  );
};
