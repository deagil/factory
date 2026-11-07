import { existsSync } from "node:fs";

import { defineConfig } from "drizzle-kit";

// drizzle-kit runs from this folder; `.env` is at the repo root.
const envFile = "../../.env";
if (existsSync(envFile)) {
  process.loadEnvFile(envFile);
}

// The core tables and the CRM's objects: `pnpm dev` pushes both to the
// change's database (decision 0031).
export default defineConfig({
  dialect: "postgresql",
  schema: ["../../packages/db/src/schema/core.ts", "./src/objects.ts"],
  schemaFilter: ["public", "auth"],
  dbCredentials: { url: process.env.DATABASE_URL ?? "" },
  strict: true,
});
