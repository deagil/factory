import type { AnyQueryDefinition } from "@workspace/actions";
import { checkSchema, coreTables } from "@workspace/db";
import { createServer } from "@workspace/server";
import type { Server } from "@workspace/server";
import {
  createSystemDatabase,
  httpSurface,
  identitySamples,
  mcpSurface,
  runContract,
} from "@workspace/server/testing";
import type { SystemDatabase } from "@workspace/server/testing";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { seed } from "./seed.ts";
import type { Seeded } from "./seed.ts";
import { crm } from "./system.ts";

const bearer = (key: string | null) => ({
  authorization: `Bearer ${key}`,
  "content-type": "application/json",
});

describe("example CRM", () => {
  let database: SystemDatabase;
  let server: Server;
  let seeded: Seeded;

  beforeAll(async () => {
    // Built from the committed migrations alone, as a deployed CRM's is.
    database = await createSystemDatabase(crm);
    server = await createServer(crm, {
      databaseUrl: database.url,
      authSecret: "a-test-secret-that-is-at-least-32-characters",
      baseURL: "http://localhost:4000",
    });
    seeded = await seed(crm, server.db, server.pipeline);
  });

  afterAll(async () => {
    await server?.close();
    await database?.close();
  });

  it("matches the schema check once migrated", async () => {
    const result = await checkSchema(database.db, [
      ...coreTables,
      ...crm.tables,
    ]);
    expect(result.problems).toStrictEqual([]);
  });

  it("seeds once, and a second run changes nothing", async () => {
    const again = await seed(crm, server.db, server.pipeline);
    const listed = await server.app.request("/queries/organisation.list", {
      method: "POST",
      headers: bearer(seeded.agentKey),
      body: "{}",
    });
    const { output } = (await listed.json()) as {
      output: { records: unknown[] };
    };
    expect(seeded.agentKey).toMatch(/^fx_/u);
    expect(again.agentKey).toBeNull();
    expect(output.records).toHaveLength(3);
  });

  it("gives the Website integration a key that can only create organisations", async () => {
    const as = (route: string, body: unknown) =>
      server.app.request(route, {
        method: "POST",
        headers: bearer(seeded.integrationKey),
        body: JSON.stringify(body),
      });
    const created = await as("/actions/organisation.create", {
      name: "Signed up online",
    });
    const listed = await as("/queries/contact.list", {});
    expect(seeded.integrationKey).toMatch(/^fx_/u);
    expect(created.status).toBe(200);
    expect(listed.status).toBe(403);
  });

  /** Runs an action over HTTP as the seeded agent. */
  const call = async (name: string, input: unknown) => {
    const response = await server.app.request(`/actions/${name}`, {
      method: "POST",
      headers: bearer(seeded.agentKey),
      body: JSON.stringify(input),
    });
    return (await response.json()) as {
      output?: { record: { id: string; organisation: string } };
      error?: { code: string };
      actionId: string;
    };
  };

  it("takes an industry only from the industries list, and filters by it", async () => {
    const unknown = await call("organisation.create", {
      name: "Rocket Co",
      industry: "aerospace",
    });
    const made = await call("organisation.create", {
      name: "Corner Shop",
      industry: "retail",
    });
    const listed = await server.pipeline.query(
      crm.registry.get("organisation.list") as AnyQueryDefinition,
      { filter: { industry: { eq: "retail" } } },
      seeded.admin
    );
    expect(unknown.error?.code).toBe("validation");
    expect(listed).toMatchObject({
      ok: true,
      output: { records: [{ id: made.output?.record.id }] },
    });
  });

  it("starts a deal in an open stage, moves it only through deal.moveStage, and records the category", async () => {
    const buyer = await call("organisation.create", { name: "Buyer" });
    const startWon = await call("deal.create", {
      name: "Already won",
      organisation: buyer.output?.record.id,
      stage: "won",
    });
    const made = await call("deal.create", {
      name: "New logo",
      organisation: buyer.output?.record.id,
      value: { amount: 5000, currency: "GBP" },
      stage: "lead",
    });
    const id = made.output?.record.id;
    const viaUpdate = await call("deal.update", { id, stage: "won" });
    const unknown = await call("deal.moveStage", { id, stage: "nope" });
    const lostBare = await call("deal.moveStage", { id, stage: "lost" });
    const moved = await call("deal.moveStage", { id, stage: "qualified" });
    const lost = await call("deal.moveStage", {
      id,
      stage: "lost",
      reason: "They chose someone else",
    });
    const event = await database.db.query.eventLog.findFirst({
      where: (t, { eq }) => eq(t.actionId, moved.actionId),
    });
    const history = await server.pipeline.query(
      crm.registry.get("record.history") as AnyQueryDefinition,
      { object: "deal", id },
      seeded.admin
    );
    expect(
      [startWon, viaUpdate, unknown, lostBare].map(
        (result) => result.error?.code
      )
    ).toStrictEqual(["validation", "validation", "validation", "validation"]);
    expect([moved.output?.record, lost.output?.record]).toMatchObject([
      { stage: "qualified" },
      { stage: "lost" },
    ]);
    expect(event).toMatchObject({
      type: "deal.stageChanged",
      payload: {
        dealId: id,
        from: "lead",
        to: "qualified",
        category: "open",
      },
    });
    expect(history).toMatchObject({
      ok: true,
      output: {
        entries: expect.arrayContaining([
          expect.objectContaining({
            action: "deal.moveStage",
            before: { stage: "lead" },
            after: { stage: "qualified" },
          }),
        ]),
      },
    });
  });

  it("moves a contact only through contact.moveToOrganisation", async () => {
    const [from, to] = await Promise.all([
      call("organisation.create", { name: "From" }),
      call("organisation.create", { name: "To" }),
    ]);
    const made = await call("contact.create", {
      firstName: "Mover",
      organisation: from.output?.record.id,
      active: true,
    });
    const id = made.output?.record.id;
    const viaUpdate = await call("contact.update", {
      id,
      organisation: to.output?.record.id,
    });
    const moved = await call("contact.moveToOrganisation", {
      id,
      organisation: to.output?.record.id,
    });
    const event = await database.db.query.eventLog.findFirst({
      where: (t, { eq }) => eq(t.actionId, moved.actionId),
    });
    expect(viaUpdate.error?.code).toBe("validation");
    expect(moved.output?.record.organisation).toBe(to.output?.record.id);
    expect(event).toMatchObject({
      type: "contact.moved",
      payload: {
        contactId: id,
        from: from.output?.record.id,
        to: to.output?.record.id,
      },
    });
  });

  // It runs every action and query over both surfaces, which takes seconds
  // on CI, so it gets more than the default 5s.
  it("gives the same results and log rows over HTTP and MCP", async () => {
    const caller = seeded.admin;
    const request = (url: string, init: RequestInit) =>
      server.app.request(url, {
        ...init,
        headers: { ...(init.headers as object), ...bearer(seeded.agentKey) },
      });
    const run = (name: string, input: unknown) => {
      const action = crm.registry.get(name);
      return action?.kind === "action"
        ? server.pipeline.run(action, input, caller)
        : Promise.reject(new Error(name));
    };
    const problems = await runContract({
      choices: server.config.service.choices,
      registry: crm.registry,
      objects: crm.objects,
      pipeline: server.pipeline,
      db: server.db,
      caller,
      surfaces: { http: httpSurface(request), mcp: mcpSurface(request) },
      samples: {
        ...identitySamples(crm.registry, server.pipeline, caller),
        "deal.create": async () => {
          const org = await run("organisation.create", { name: "Buyer" });
          return {
            name: "Sample deal",
            organisation:
              org.ok && (org.output as { record: { id: string } }).record.id,
            value: { amount: 250_000, currency: "GBP" },
            stage: "lead",
          };
        },
        "deal.moveStage": async () => {
          const org = await run("organisation.create", { name: "Buyer" });
          const created = await run("deal.create", {
            name: "Sample deal",
            organisation:
              org.ok && (org.output as { record: { id: string } }).record.id,
            stage: "lead",
          });
          return {
            id:
              created.ok &&
              (created.output as { record: { id: string } }).record.id,
            stage: "qualified",
          };
        },
        "contact.moveToOrganisation": async () => {
          const org = await run("organisation.create", { name: "Target" });
          const other = await run("organisation.create", { name: "Start" });
          const person = await run("contact.create", {
            firstName: "Sam",
            active: true,
            organisation:
              other.ok &&
              (other.output as { record: { id: string } }).record.id,
          });
          return {
            id:
              person.ok &&
              (person.output as { record: { id: string } }).record.id,
            organisation:
              org.ok && (org.output as { record: { id: string } }).record.id,
          };
        },
      },
    });
    expect(problems).toStrictEqual([]);
  }, 20_000);
});
