import { execFileSync } from "node:child_process";
import {
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  realpathSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { setTimeout as sleep } from "node:timers/promises";

import { createTestDatabase } from "@workspace/testing";
import { databaseUrl } from "@workspace/testing/databases";
import { Client } from "pg";
import { describe, expect, it, vi } from "vitest";

import {
  createPushQueue,
  dev,
  formatDevEvent,
  pushFailure,
  pushSchema,
  schemaDir,
  watchSchema,
} from "./commands/dev.ts";
import type { DevEvent, PushResult } from "./commands/dev.ts";
import { saveChange } from "./state.ts";

const repoRoot = path.resolve(import.meta.dirname, "../../..");
const migrationsDir = path.join(repoRoot, "packages", "db", "migrations");

const query = async (url: string, sql: string) => {
  const client = new Client({ connectionString: url });
  await client.connect();
  try {
    return await client.query(sql);
  } finally {
    await client.end();
  }
};

const tableNames = async (url: string): Promise<string[]> => {
  const { rows } = await query(
    url,
    "select table_name from information_schema.tables where table_schema = 'public' order by table_name"
  );
  return rows.map((row: { table_name: string }) => row.table_name);
};

/** A repo whose main checkout is itself the worktree of change "try it". */
const changeRepo = async (database = "factory_try_it") => {
  const root = realpathSync(mkdtempSync(path.join(tmpdir(), "fx-dev-")));
  const repo = path.join(root, "factory");
  execFileSync("git", ["init", "-q", "-b", "main", repo]);
  mkdirSync(schemaDir(repo), { recursive: true });
  await saveChange(path.join(repo, ".fx"), {
    name: "try it",
    slug: "try-it",
    branch: "change/try-it",
    worktree: repo,
    database,
    createdAt: "2026-11-06T10:00:00.000Z",
    lastCheck: null,
  });
  return repo;
};

/** A stand-in for the dev servers: records DATABASE_URL, exits when told. */
const fakeServers = (dir: string, exitCode: number) => {
  const seen = path.join(dir, "seen-url");
  const stop = path.join(dir, "stop");
  const script = `
    const fs = require("node:fs");
    fs.writeFileSync(${JSON.stringify(seen)}, process.env.DATABASE_URL ?? "");
    setInterval(() => { if (fs.existsSync(${JSON.stringify(stop)})) process.exit(${exitCode}); }, 20);
  `;
  return {
    command: [process.execPath, "-e", script] as [string, ...string[]],
    seenUrl: () => readFileSync(seen, "utf-8"),
    stop: () => writeFileSync(stop, ""),
  };
};

const okPush = (): Promise<PushResult> => Promise.resolve({ ok: true, ms: 5 });

describe(pushFailure, () => {
  it("accepts applied changes and no changes", () => {
    expect(
      pushFailure("[✓] Pulling schema\n[✓] Changes applied")
    ).toBeUndefined();
    expect(
      pushFailure("[\u001B[34mi\u001B[39m] No changes detected")
    ).toBeUndefined();
  });

  it("explains a rename drizzle-kit would need to ask about", () => {
    expect(
      pushFailure(
        "Error: Interactive prompts require a TTY terminal (process.stdin.isTTY is false)."
      )
    ).toMatchObject({
      code: "schema_push_failed",
      hint: expect.stringContaining("fx dev --reset"),
    });
  });

  it("reports the error line from other failures", () => {
    expect(
      pushFailure(
        'Reading config file\nerror: database "factory_gone" does not exist\n    at Parser'
      )
    ).toMatchObject({
      code: "schema_push_failed",
      message:
        'drizzle-kit push failed: error: database "factory_gone" does not exist',
    });
  });
});

describe(createPushQueue, () => {
  it("folds requests made during a push into one more push", async () => {
    const gates: PromiseWithResolvers<undefined>[] = [];
    const queue = createPushQueue(() => {
      const gate = Promise.withResolvers<undefined>();
      gates.push(gate);
      return gate.promise;
    });
    queue.request();
    queue.request();
    queue.request();
    expect(gates).toHaveLength(1);

    gates[0]?.resolve(undefined);
    await vi.waitFor(() => expect(gates).toHaveLength(2));
    gates[1]?.resolve(undefined);
    await queue.idle();
    expect(gates).toHaveLength(2);
  });
});

describe(watchSchema, () => {
  it("reports a burst of edits to a schema file once", async () => {
    const dir = mkdtempSync(path.join(tmpdir(), "fx-watch-"));
    const calls: string[] = [];
    const close = watchSchema(dir, (file) => calls.push(file), 100);
    try {
      // The OS watcher takes a moment to start, longer on a busy machine.
      await sleep(200);
      writeFileSync(path.join(dir, "notes.md"), "ignored");
      writeFileSync(path.join(dir, "core.test.ts"), "ignored");
      writeFileSync(path.join(dir, "core.ts"), "one");
      writeFileSync(path.join(dir, "core.ts"), "two");
      await vi.waitFor(() => expect(calls).toStrictEqual(["core.ts"]), {
        timeout: 5000,
      });
      await sleep(300);
      expect(calls).toStrictEqual(["core.ts"]);
    } finally {
      close();
    }
  });
});

describe(pushSchema, () => {
  it(
    "brings a database up to the schema without writing a migration",
    { timeout: 60_000 },
    async () => {
      const db = await createTestDatabase();
      try {
        await query(db.url, "drop table event_log");
        const before = readdirSync(migrationsDir, { recursive: true });

        await expect(pushSchema(repoRoot, db.url)).resolves.toMatchObject({
          ok: true,
        });
        await expect(tableNames(db.url)).resolves.toContain("event_log");
        expect(readdirSync(migrationsDir, { recursive: true })).toStrictEqual(
          before
        );
      } finally {
        await db.drop();
      }
    }
  );

  it(
    "fails, even though drizzle-kit exits 0, when the database is missing",
    { timeout: 60_000 },
    async () => {
      const url = databaseUrl(
        process.env.DATABASE_ADMIN_URL ?? "",
        "factory_test_missing_database"
      );
      const result = await pushSchema(repoRoot, url);
      expect(result).toMatchObject({
        ok: false,
        error: { code: "schema_push_failed" },
      });
    }
  );
});

describe(dev, () => {
  it("refuses to run outside a change", async () => {
    const root = realpathSync(mkdtempSync(path.join(tmpdir(), "fx-dev-")));
    execFileSync("git", ["init", "-q", "-b", "main", root]);
    await expect(dev(root, { push: okPush })).rejects.toMatchObject({
      code: "change_not_found",
    });
  });

  it("asks for pnpm install when the worktree has no turbo", async () => {
    const repo = await changeRepo();
    await expect(dev(repo, { push: okPush })).rejects.toMatchObject({
      code: "command_failed",
      hint: "Run `pnpm install` in the worktree.",
    });
  });

  it(
    "stops the dev servers when told to stop",
    { timeout: 20_000 },
    async () => {
      const repo = await changeRepo();
      const servers = fakeServers(repo, 3);
      const controller = new AbortController();
      const running = dev(repo, {
        write: () => {},
        command: servers.command,
        push: okPush,
        signal: controller.signal,
      });
      await vi.waitFor(() => expect(servers.seenUrl()).not.toBe(""));
      controller.abort();
      await expect(running).resolves.toBe(0);
    }
  );

  it(
    "pushes on start and on every schema save, and runs the servers on the change's database",
    { timeout: 20_000 },
    async () => {
      const repo = await changeRepo();
      const servers = fakeServers(repo, 3);
      const pushes: string[] = [];
      const lines: string[] = [];
      const running = dev(repo, {
        json: true,
        write: (line) => lines.push(line),
        command: servers.command,
        debounceMs: 50,
        push: async (_worktree, url) => {
          pushes.push(url);
          return await okPush();
        },
      });
      const expectedUrl = databaseUrl(
        process.env.DATABASE_ADMIN_URL ?? "",
        "factory_try_it"
      );

      await vi.waitFor(() => expect(servers.seenUrl()).toBe(expectedUrl));
      writeFileSync(path.join(schemaDir(repo), "core.ts"), "export {};\n");
      await vi.waitFor(() => expect(pushes).toHaveLength(2));
      servers.stop();

      await expect(running).resolves.toBe(3);
      const events = lines.map((line) => JSON.parse(line) as DevEvent);
      expect(events.map((event) => [event.event, event.ok])).toStrictEqual([
        ["started", true],
        ["schema_pushed", true],
        ["schema_pushed", true],
        ["stopped", false],
      ]);
    }
  );

  it(
    "rebuilds the change's database empty with --reset",
    { timeout: 20_000 },
    async () => {
      const db = await createTestDatabase();
      try {
        const repo = await changeRepo(db.name);
        const servers = fakeServers(repo, 0);
        servers.stop();
        const code = await dev(repo, {
          reset: true,
          write: () => {},
          command: servers.command,
          push: okPush,
        });
        expect(code).toBe(0);
        await expect(tableNames(db.url)).resolves.toStrictEqual([]);
      } finally {
        await db.drop();
      }
    }
  );
});

describe(formatDevEvent, () => {
  it("names the database and says no migrations are written", () => {
    const text = formatDevEvent({
      ok: true,
      event: "started",
      change: "try it",
      database: "factory_try_it",
      server: "factory_try_it on localhost:5432",
      reset: false,
    });
    expect(text).toContain("factory_try_it on localhost:5432");
    expect(text).toContain("no migration files");
  });
});
