// Shared body of isolation-a.test.ts and isolation-b.test.ts: two test files
// that write to the same table at the same time, each in its own database.

import { setTimeout as sleep } from "node:timers/promises";

import { Client } from "pg";
import { afterAll, beforeAll, describe, expect, inject, it } from "vitest";

import {
  createTestDatabase,
  listDatabases,
  testDatabasePrefix,
  withAdmin,
} from "./database.ts";
import type { TestDatabase } from "./database.ts";

const otherTestDatabase = (own: string) =>
  withAdmin(async (client) => {
    const names = await listDatabases(
      client,
      `${testDatabasePrefix}${inject("testDatabaseRunId")}_`
    );
    return names.find((name) => name !== own);
  });

// On a cold run both files build the template at the same time, so the
// sibling can take several seconds to appear.
const siblingTimeoutMs = 15_000;

/** Waits until the sibling file's database exists, proving both files run at once. */
const waitForSibling = async (
  own: string,
  deadline = Date.now() + siblingTimeoutMs
): Promise<string> => {
  const other = await otherTestDatabase(own);
  if (other) {
    return other;
  }
  if (Date.now() > deadline) {
    throw new Error("the sibling test file never ran alongside this one");
  }
  await sleep(50);
  return waitForSibling(own, deadline);
};

export const defineIsolationSuite = (label: string) => {
  describe(`test database isolation (${label})`, () => {
    let database: TestDatabase;
    let client: Client;

    beforeAll(async () => {
      database = await createTestDatabase();
      client = new Client({ connectionString: database.url });
      await client.connect();
    });

    afterAll(async () => {
      await client.end();
      await database.drop();
    });

    it(
      "runs alongside the other file and sees only its own rows",
      async () => {
        await client.query("insert into users (name, email) values ($1, $2)", [
          label,
          `${label}@example.com`,
        ]);

        const sibling = await waitForSibling(database.name);
        expect(sibling).not.toBe(database.name);
        // Keep this database alive long enough for the sibling to see it too.
        await sleep(1000);

        const { rows } = await client.query("select email from users");
        expect(rows).toStrictEqual([{ email: `${label}@example.com` }]);
      },
      siblingTimeoutMs + 5000
    );
  });
};
