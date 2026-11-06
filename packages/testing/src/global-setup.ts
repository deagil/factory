// Vitest global setup for every package (see vitest.ts). Gives each run an
// ID, and on teardown drops any test databases from this run that a crashed
// test file left behind.

import { randomBytes } from "node:crypto";

import type { TestProject } from "vitest/node";

import {
  dropDatabase,
  listDatabases,
  testDatabasePrefix,
  withAdmin,
} from "./database.ts";

const globalSetup = (project: TestProject) => {
  const runId = randomBytes(4).toString("hex");
  project.provide("testDatabaseRunId", runId);

  return async () => {
    if (!process.env.DATABASE_ADMIN_URL) {
      return;
    }
    await withAdmin(async (client) => {
      const leftovers = await listDatabases(
        client,
        `${testDatabasePrefix}${runId}_`
      );
      await Promise.all(leftovers.map((name) => dropDatabase(client, name)));
    });
  };
};

export default globalSetup;
