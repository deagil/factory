import { existsSync } from "node:fs";

import { defineConfig } from "drizzle-kit";
import { getTableName, is } from "drizzle-orm";
import { PgTable } from "drizzle-orm/pg-core";

import * as core from "./src/schema/core.ts";

// drizzle-kit runs from this package's folder; `.env` is at the repo root.
const envFile = "../../.env";
if (existsSync(envFile)) {
  process.loadEnvFile(envFile);
}

// Only the core's own tables. A system's tables (examples/crm) live in the
// same database during development, and pushing the core schema must not
// drop them (decision 0031).
const coreTableNames = Object.values(core)
  .filter((value) => is(value, PgTable))
  .map((table) => getTableName(table));

export default defineConfig({
  dialect: "postgresql",
  schema: "./src/schema/core.ts",
  out: "./migrations",
  // Better Auth's tables are in `auth` (decision 0023).
  schemaFilter: ["public", "auth"],
  tablesFilter: coreTableNames,
  dbCredentials: { url: process.env.DATABASE_URL ?? "" },
  strict: true,
  verbose: true,
});
