import { randomBytes } from "node:crypto";
import { cpSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import {
  coreMigrationsFolder,
  databaseUrl,
  dropDatabase,
  ensureTemplateDatabase,
  listDatabases,
  migrationsHash,
  templatePrefix,
  withAdmin,
} from "./databases.ts";

describe(databaseUrl, () => {
  it("swaps the database name and keeps the rest", () => {
    expect(
      databaseUrl(
        "postgres://u:p@localhost:5432/postgres?sslmode=disable",
        "factory_x"
      )
    ).toBe("postgres://u:p@localhost:5432/factory_x?sslmode=disable");
  });
});

describe(migrationsHash, () => {
  it("changes when a migration changes", () => {
    const folder = mkdtempSync(path.join(tmpdir(), "migrations-"));
    writeFileSync(path.join(folder, "0000_a.sql"), "create table a ();");
    const before = migrationsHash(folder);
    expect(migrationsHash(folder)).toBe(before);
    writeFileSync(path.join(folder, "0000_a.sql"), "create table b ();");
    expect(migrationsHash(folder)).not.toBe(before);
  });
});

describe(ensureTemplateDatabase, () => {
  it(
    "builds one template, even when called concurrently",
    { timeout: 30_000 },
    async () => {
      // A copy of the core migrations with a unique hash, so this test's
      // template and builds can't be confused with other test files'.
      const folder = mkdtempSync(path.join(tmpdir(), "migrations-"));
      cpSync(coreMigrationsFolder, folder, { recursive: true });
      writeFileSync(
        path.join(folder, "unique.json"),
        JSON.stringify(randomBytes(8).toString("hex"))
      );
      const expected = `${templatePrefix}${migrationsHash(folder)}`;

      const names = await Promise.all([
        ensureTemplateDatabase(folder),
        ensureTemplateDatabase(folder),
        ensureTemplateDatabase(folder),
      ]);
      const [templates, builds] = await withAdmin(async (client) => {
        const found = await listDatabases(client, expected);
        await dropDatabase(client, expected);
        return [found, found.filter((name) => name.includes("_build_"))];
      });

      expect(names).toStrictEqual([expected, expected, expected]);
      expect(templates).toStrictEqual([expected]);
      expect(builds).toStrictEqual([]);
    }
  );
});
