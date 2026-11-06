// `pnpm db:check-migrations`: applies every migration to an empty database,
// then fails if drizzle-kit would generate a new migration, which means the
// schema changed without one.
import { execFileSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";

import { databaseUrl, dropDatabase, withAdmin } from "@workspace/testing";

import { loadEnv, requireEnv } from "../env.ts";
import { migrationsFolder, runMigrations } from "../migrate.ts";

const journalFile = path.join(migrationsFolder, "meta", "_journal.json");
const migrationTags = (): string[] =>
  (
    JSON.parse(readFileSync(journalFile, "utf-8")) as {
      entries: { tag: string }[];
    }
  ).entries.map((entry) => entry.tag);

loadEnv();
const adminUrl = requireEnv("DATABASE_ADMIN_URL");

// 1. Every migration applies to an empty database.
const name = `factory_check_${randomBytes(4).toString("hex")}`;
await withAdmin(
  (client) => client.query(`create database "${name}"`),
  adminUrl
);
try {
  await runMigrations(databaseUrl(adminUrl, name));
} finally {
  await withAdmin((client) => dropDatabase(client, name), adminUrl);
}
process.stdout.write(
  `Applied ${migrationTags().length} migration(s) to an empty database.\n`
);

// 2. The schema has no changes that lack a migration.
const before = new Set(migrationTags());
execFileSync("drizzle-kit", ["generate"], {
  cwd: path.resolve(migrationsFolder, ".."),
  stdio: ["ignore", "ignore", "inherit"],
});
const added = migrationTags().filter((tag) => !before.has(tag));
if (added.length > 0) {
  process.stderr.write(
    `The schema has changes with no migration. drizzle-kit just generated ${added.map((tag) => `migrations/${tag}.sql`).join(", ")}.\nReview and commit it; fx ship does this for you.\n`
  );
  process.exitCode = 1;
} else {
  process.stdout.write("Schema and migrations match.\n");
}
