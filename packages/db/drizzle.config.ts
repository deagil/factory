import { existsSync } from "node:fs";

import { defineConfig } from "drizzle-kit";

// drizzle-kit runs from this package's folder; `.env` is at the repo root.
const envFile = "../../.env";
if (existsSync(envFile)) {
  process.loadEnvFile(envFile);
}

export default defineConfig({
  dialect: "postgresql",
  schema: "./src/schema/core.ts",
  out: "./migrations",
  // Better Auth's tables are in `auth` (decision 0023).
  schemaFilter: ["public", "auth"],
  dbCredentials: { url: process.env.DATABASE_URL ?? "" },
  strict: true,
  verbose: true,
});
