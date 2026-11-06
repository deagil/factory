// `pnpm db:check-migrations`: applies every migration to an empty database,
// then fails if drizzle-kit would generate a new migration, which means the
// schema changed without one.
import { spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import { stripVTControlCharacters } from "node:util";

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

// 2. The schema has no changes that lack a migration. drizzle-kit exits 0
// even when it fails (for example when it would have to ask whether a
// column was renamed), so its output decides.
const before = new Set(migrationTags());
const generate = spawnSync("drizzle-kit", ["generate"], {
  cwd: path.resolve(migrationsFolder, ".."),
  encoding: "utf-8",
  stdio: ["ignore", "pipe", "pipe"],
});
const output = stripVTControlCharacters(`${generate.stdout}${generate.stderr}`);
const added = migrationTags().filter((tag) => !before.has(tag));
if (added.length > 0) {
  process.stderr.write(
    `The schema has changes with no migration. drizzle-kit just generated ${added.map((tag) => `migrations/${tag}.sql`).join(", ")}.\nReview and commit it; fx ship does this for you.\n`
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
