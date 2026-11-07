// Runs the CRM: `pnpm dev` (through `fx dev`) pushes the schema, then starts
// this, which seeds the database and serves the API, sign-in and MCP.
import { existsSync } from "node:fs";
import path from "node:path";

import { createServer } from "@workspace/server";

import { seed } from "./seed.ts";
import { crm } from "./system.ts";

const envFile = path.resolve(import.meta.dirname, "../../../.env");
if (existsSync(envFile)) {
  process.loadEnvFile(envFile);
}

const port = Number(process.env.PORT ?? 4000);
const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  throw new Error(
    "Set DATABASE_URL; fx start writes it to the worktree's .env."
  );
}
const authSecret =
  process.env.BETTER_AUTH_SECRET ||
  (process.env.NODE_ENV === "production"
    ? ""
    : "a-local-development-secret-of-32-characters");
if (authSecret.length < 32) {
  throw new Error("Set BETTER_AUTH_SECRET to at least 32 characters.");
}

const server = await createServer(crm, {
  databaseUrl,
  authSecret,
  // The web app proxies /auth and /api here, so sign-in happens on its
  // origin (decision 0032).
  baseURL: process.env.BETTER_AUTH_URL ?? "http://localhost:3000",
  trustedOrigins: [`http://localhost:${port}`],
  // `pnpm dev` sets FACTORY_DEV, so the dev bar can sign in as anyone.
  devOutbox:
    process.env.FACTORY_DEV === "1" && process.env.NODE_ENV !== "production",
});
const seeded = await seed(crm, server.db, server.pipeline);
const listening = server.listen(port);

console.info(`${crm.name} on http://localhost:${port}`);
console.info(`  OpenAPI: http://localhost:${port}/openapi.json`);
console.info(`  MCP:     http://localhost:${port}/mcp`);
if (seeded.agentKey) {
  console.info(
    `  Agent key for admin@example.com (shown once): ${seeded.agentKey}`
  );
}
if (seeded.integrationKey) {
  console.info(
    `  Website integration key (shown once): ${seeded.integrationKey}`
  );
}

const stop = async () => {
  await listening.close();
  process.exit(0);
};
process.once("SIGTERM", stop);
process.once("SIGINT", stop);
