import { existsSync } from "node:fs";

import { defineConfig } from "drizzle-kit";
import { getTableName, is } from "drizzle-orm";
import { PgTable } from "drizzle-orm/pg-core";

import * as objects from "./src/objects.ts";

// drizzle-kit runs from this folder; `.env` is at the repo root.
const envFile = "../../.env";
if (existsSync(envFile)) {
  process.loadEnvFile(envFile);
}

// Only the CRM's own tables (decision 0036). `fx ship` generates the CRM's
// migrations into ./migrations; they apply after the core's. `pnpm dev`
// pushes these tables to the change's database, and the filter keeps the
// push from touching the core's, which `fx dev` pushes from packages/db.
const tableNames = Object.values(objects)
  .filter((value) => is(value, PgTable))
  .map((table) => getTableName(table));

export default defineConfig({
  dialect: "postgresql",
  schema: "./src/objects.ts",
  out: "./migrations",
  schemaFilter: ["public"],
  tablesFilter: tableNames,
  dbCredentials: { url: process.env.DATABASE_URL ?? "" },
  strict: true,
});
