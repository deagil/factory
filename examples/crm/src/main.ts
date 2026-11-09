// Runs the CRM: `pnpm dev` (through `fx dev`) pushes the schema, then starts
// this, which seeds the database and serves the API, sign-in and MCP.
// `pnpm start` applies the core's migrations and the CRM's first instead.
import { existsSync } from "node:fs";
import path from "node:path";

import { ensureLocalRemote } from "@workspace/config";
import { redactUrl, runMigrations } from "@workspace/db";
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

// Under `pnpm dev` the schema is pushed, not migrated, so there is nothing
// to apply; the two must not both run on one database.
const dev = process.env.FACTORY_DEV === "1";
if (!dev) {
  await runMigrations(databaseUrl, { system: crm.migrations });
  console.info(`Migrations applied to ${redactUrl(databaseUrl)}`);
}

// Drafts need a config remote. CONFIG_REMOTE is its URL, or `local` for a
// bare repository in.factory/, made from config/ the first time.
// Without it, config/ is read from the working tree and reloaded on save.
const factoryDir = path.resolve(import.meta.dirname, "../../../.factory");
const remoteSetting = process.env.CONFIG_REMOTE;
const remoteUrl =
  remoteSetting === "local"
    ? path.join(factoryDir, "config.git")
    : remoteSetting;
if (
  remoteSetting === "local" &&
  remoteUrl &&
  crm.config &&
  (await ensureLocalRemote(remoteUrl, crm.config))
) {
  console.info(`Made a local config remote at ${remoteUrl}`);
}

const server = await createServer(crm, {
  databaseUrl,
  authSecret,
  // The web app proxies /auth and /api here, so sign-in happens on its
  // origin (decision 0032).
  baseURL: process.env.BETTER_AUTH_URL ?? "http://localhost:3000",
  trustedOrigins: [`http://localhost:${port}`],
  // `pnpm dev` sets FACTORY_DEV, so the dev bar can sign in as anyone.
  devOutbox: dev && process.env.NODE_ENV !== "production",
  // Locally, config/ is read from the working tree and reloaded on save,
  // unless there's a config remote.
  watchConfig: dev && !remoteUrl,
  ...(remoteUrl
    ? {
        configRemote: {
          url: remoteUrl,
          cacheDir: path.join(factoryDir, "config-cache.git"),
        },
      }
    : {}),
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
