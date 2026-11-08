// The CRM's config, loaded by the running server (P2.05): editing a role
// changes what people can do without a restart, every action_log row has the
// config version it ran under, and a broken file leaves the last good one.
import { cpSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import type {
  AnyActionDefinition,
  AnyQueryDefinition,
} from "@workspace/actions";
import { bootstrapStaff, listConfigVersions } from "@workspace/db";
import { createServer, defineSystem } from "@workspace/server";
import type { Server } from "@workspace/server";
import { createSystemDatabase } from "@workspace/server/testing";
import type { SystemDatabase } from "@workspace/server/testing";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { crm } from "./system.ts";

describe("the CRM's config", () => {
  // A copy of config/ this test can edit, in a system that reads it.
  const config = path.join(mkdtempSync(path.join(tmpdir(), "crm-")), "config");
  cpSync(path.resolve(import.meta.dirname, "../config"), config, {
    recursive: true,
  });
  const system = defineSystem({
    name: crm.name,
    objects: crm.objects,
    actions: crm.registry
      .list()
      .filter(
        (definition) =>
          definition.name === "contact.moveToOrganisation" ||
          definition.name === "deal.create" ||
          definition.name === "deal.moveStage"
      ),
    migrations: crm.migrations,
    config,
  });
  const supportFile = path.join(config, "roles", "support.yaml");
  const original = readFileSync(supportFile, "utf-8");

  let database: SystemDatabase;
  let server: Server;
  let sam: { actorId: string };

  const listOrganisations = () =>
    server.pipeline.query(
      system.registry.get("organisation.list") as AnyQueryDefinition,
      {},
      sam
    );

  beforeAll(async () => {
    database = await createSystemDatabase(system);
    server = await createServer(system, {
      databaseUrl: database.url,
      authSecret: "a-test-secret-that-is-at-least-32-characters",
      baseURL: "http://localhost:4000",
      log: () => {},
    });
    const support = await bootstrapStaff(server.db, {
      name: "Sam Support",
      email: "sam@example.com",
      roles: ["support"],
    });
    sam = { actorId: support.id };
  });

  afterAll(async () => {
    await server?.close();
    await database?.close();
  });

  it("changes what a role can do once the file is reloaded", async () => {
    await expect(listOrganisations()).resolves.toMatchObject({
      ok: false,
      error: { code: "permission" },
    });
    writeFileSync(
      supportFile,
      `${original}  - object: organisation\n    can: [view]\n    scope: all\n`
    );
    await expect(server.config.load()).resolves.toMatchObject({
      status: "loaded",
    });
    await expect(listOrganisations()).resolves.toMatchObject({ ok: true });
  });

  it("records the config version on each action_log row", async () => {
    const created = await server.pipeline.run(
      system.registry.get("contact.create") as AnyActionDefinition,
      { firstName: "Pat", active: true, organisation: crypto.randomUUID() },
      sam
    );
    const row = await server.db.query.actionLog.findFirst({
      where: (t, { eq }) => eq(t.id, created.actionId ?? ""),
    });
    expect(row?.configSha).toBe(server.config.current()?.sha);
  });

  it("keeps the last good version when a file breaks", async () => {
    const live = server.config.current()?.sha;
    writeFileSync(supportFile, original.replace("scope: all", "scope: some"));
    const result = await server.config.load();
    const [latest] = await listConfigVersions(server.db, 1);
    expect(result.status).toBe("refused");
    expect(server.config.current()?.sha).toBe(live);
    await expect(listOrganisations()).resolves.toMatchObject({ ok: true });
    expect(latest).toMatchObject({
      status: "refused",
      errors: [
        expect.objectContaining({
          file: "config/roles/support.yaml",
          line: 6,
        }),
      ],
    });
  });
});
