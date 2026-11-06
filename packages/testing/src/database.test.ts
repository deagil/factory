import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import {
  coreMigrationsFolder,
  databaseUrl,
  ensureTemplateDatabase,
  listDatabases,
  migrationsHash,
  templatePrefix,
  withAdmin,
} from "./database.ts";

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
  it("builds one template for the current migrations, even when called concurrently", async () => {
    const names = await Promise.all([
      ensureTemplateDatabase(),
      ensureTemplateDatabase(),
      ensureTemplateDatabase(),
    ]);
    const expected = `${templatePrefix}${migrationsHash(coreMigrationsFolder)}`;
    expect(names).toStrictEqual([expected, expected, expected]);

    const templates = await withAdmin((client) =>
      listDatabases(client, templatePrefix)
    );
    expect(templates).toContain(expected);
    expect(templates.filter((name) => name.includes("_build_"))).toStrictEqual(
      []
    );
  });
});
