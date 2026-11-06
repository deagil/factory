# @workspace/testing

Seed fixtures, test database helpers and, from phase 1, generated contract tests.

Design: [docs/SYSTEM_DESIGN.md](../../docs/SYSTEM_DESIGN.md), section 6. Delivery.

## Test databases

```ts
import { createTestDatabase } from "@workspace/testing";
import type { TestDatabase } from "@workspace/testing";

describe("something that writes", () => {
  let database: TestDatabase;
  let db: Db;

  beforeAll(async () => {
    database = await createTestDatabase(); // fresh, migrated, only this file's
    db = createDb(database.url);
  });

  afterAll(async () => {
    await closeDb(db);
    await database.drop();
  });
});
```

- Each test file gets its own database, `factory_test_<run>_<random>`, created from a migrated template.
- The template, `factory_template_<hash of the migrations>`, is built the first time a test needs it and reused until the migrations change. It is safe to build from parallel processes.
- The shared Vitest config's global teardown drops any database from the run that a crashed file left behind.
- Tests never touch the dev database. The shared config removes `DATABASE_URL`, and test databases are created through `DATABASE_ADMIN_URL`.

## Rules

- `@workspace/testing/vitest` is the shared Vitest config. Each package's `vitest.config.ts` re-exports it.
- This package must not depend on other workspace packages: they all devDepend on it, so that would be a cycle. That is why it applies `packages/db/migrations` by path instead of importing `@workspace/db`.
