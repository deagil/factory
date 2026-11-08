// `pnpm db:check-migrations [system-dir]`: applies every migration to an
// empty database, runs the schema check on it, then fails if drizzle-kit
// would generate a new migration, which means the schema changed without one.
//
// With no argument it checks the core's migrations. Given a system package's
// folder, it reads that package's drizzle.config.ts (its `schema` and `out`),
// applies the core's migrations and then the system's, and checks the core
// tables and the system's together (decision 0036).
import { spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { stripVTControlCharacters } from "node:util";

import { databaseUrl, dropDatabase, withAdmin } from "@workspace/testing";
import { is } from "drizzle-orm";
import { PgTable } from "drizzle-orm/pg-core";

import { closeDb, createDb } from "../client.ts";
import { loadEnv, requireEnv } from "../env.ts";
import { migrationsFolder, runMigrations } from "../migrate.ts";
import {
  checkSchema,
  coreTables,
  formatSchemaProblems,
} from "../schema-check.ts";

interface Target {
  /** Where drizzle-kit runs. */
  readonly dir: string;
  /** The migrations this run checks. */
  readonly migrations: string;
  /** A system's migrations, applied after the core's. */
  readonly system?: string;
  /** Tables to check besides the core's. */
  readonly tables: readonly PgTable[];
}

/** The system package at `dir`, from its drizzle.config.ts. */
const systemTarget = async (dir: string): Promise<Target> => {
  const configFile = path.join(dir, "drizzle.config.ts");
  const { default: config } = (await import(
    pathToFileURL(configFile).href
  )) as { default: { schema?: string | string[]; out?: string } };
  if (!config.out) {
    throw new Error(`${configFile} has no \`out\` folder for migrations.`);
  }
  const modules = await Promise.all(
    [config.schema ?? []]
      .flat()
      .map(
        (file) =>
          import(pathToFileURL(path.resolve(dir, file)).href) as Promise<
            Record<string, unknown>
          >
      )
  );
  const tables = modules
    .flatMap((exported) => Object.values(exported))
    .filter((value): value is PgTable => is(value, PgTable));
  const migrations = path.resolve(dir, config.out);
  return { dir, migrations, system: migrations, tables };
};

const target: Target = process.argv[2]
  ? await systemTarget(path.resolve(process.argv[2]))
  : {
      dir: path.resolve(migrationsFolder, ".."),
      migrations: migrationsFolder,
      tables: [],
    };

const journalFile = path.join(target.migrations, "meta", "_journal.json");
const migrationTags = (): string[] => {
  try {
    return (
      JSON.parse(readFileSync(journalFile, "utf-8")) as {
        entries: { tag: string }[];
      }
    ).entries.map((entry) => entry.tag);
  } catch {
    return [];
  }
};

loadEnv();
const adminUrl = requireEnv("DATABASE_ADMIN_URL");

// 1. Every migration applies to an empty database.
const name = `factory_check_${randomBytes(4).toString("hex")}`;
await withAdmin(
  (client) => client.query(`create database "${name}"`),
  adminUrl
);
let schemaProblems = "";
try {
  const url = databaseUrl(adminUrl, name);
  await runMigrations(url, { system: target.system });
  // 2. The migrated database matches the tables the code defines.
  const db = createDb(url, { max: 1 });
  try {
    const result = await checkSchema(db, [...coreTables, ...target.tables]);
    schemaProblems = result.ok ? "" : formatSchemaProblems(result.problems);
  } finally {
    await closeDb(db);
  }
} finally {
  await withAdmin((client) => dropDatabase(client, name), adminUrl);
}
const shown = path.relative(process.cwd(), target.migrations) || ".";
process.stdout.write(
  `Applied ${migrationTags().length} migration(s) from ${shown} to an empty database.\n`
);
if (schemaProblems) {
  process.stderr.write(`${schemaProblems}\n`);
  process.exitCode = 1;
} else {
  process.stdout.write("The migrated database passes the schema check.\n");
}

// 3. The schema has no changes that lack a migration. drizzle-kit exits 0
// even when it fails (for example when it would have to ask whether a
// column was renamed), so its output decides.
const before = new Set(migrationTags());
const generate = spawnSync("pnpm", ["exec", "drizzle-kit", "generate"], {
  cwd: target.dir,
  encoding: "utf-8",
  stdio: ["ignore", "pipe", "pipe"],
});
const output = stripVTControlCharacters(`${generate.stdout}${generate.stderr}`);
const added = migrationTags().filter((tag) => !before.has(tag));
if (added.length > 0) {
  process.stderr.write(
    `The schema has changes with no migration. drizzle-kit just generated ${added.map((tag) => `${shown}/${tag}.sql`).join(", ")}.\nReview and commit it; fx ship does this for you.\n`
  );
  process.exitCode = 1;
} else if (output.includes("nothing to migrate")) {
  process.stdout.write("Schema and migrations match.\n");
} else {
  process.stderr.write(
    `drizzle-kit generate didn't finish, so the schema may have changes with no migration:\n${output
      .split("\n")
      .filter((line) => !line.trim().startsWith("at "))
      .join("\n")
      .trim()}\n`
  );
  process.exitCode = 1;
}
