import type { AnyQueryDefinition } from "@workspace/actions";
import { checkSchema, coreTables } from "@workspace/db";
import { createServer } from "@workspace/server";
import type { Server } from "@workspace/server";
import {
  createSystemDatabase,
  httpSurface,
  configSamples,
  identitySamples,
  mcpSurface,
  restSurface,
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
  let sarahKey = "";

  beforeAll(async () => {
    // Built from the committed migrations alone, as a deployed CRM's is.
    database = await createSystemDatabase(crm);
    server = await createServer(crm, {
      databaseUrl: database.url,
      authSecret: "a-test-secret-that-is-at-least-32-characters",
      baseURL: "http://localhost:4000",
    });
    seeded = await seed(crm, server.db, server.pipeline);
    // An agent of Sarah's, in sales: her deals only, and no write on stage.
    const run = (name: string, input: unknown) =>
      server.pipeline.run(crm.registry.get(name) as never, input, seeded.sales);
    const agent = await run("actor.createAgent", { name: "Sarah's Claude" });
    const { actorId } = (agent.ok ? agent.output : {}) as { actorId: string };
    const key = await run("apiKey.create", { actorId, label: "test" });
    ({ key: sarahKey } = (key.ok ? key.output : {}) as { key: string });
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
    const listed = await server.app.request("/queries/organisation_list", {
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
    const created = await as("/actions/organisation_create", {
      name: "Signed up online",
    });
    const listed = await as("/queries/contact_list", {});
    expect(seeded.integrationKey).toMatch(/^fx_/u);
    expect(created.status).toBe(200);
    expect(listed.status).toBe(403);
  });

  /** Runs an action over HTTP as the seeded agent (the admin's), or `key`. */
  const call = async (name: string, input: unknown, key = seeded.agentKey) => {
    const response = await server.app.request(`/actions/${name}`, {
      method: "POST",
      headers: bearer(key),
      body: JSON.stringify(input),
    });
    return (await response.json()) as {
      output?: { record: { id: string; organisation: string } };
      error?: { code: string };
      runId: string;
    };
  };

  it("takes an industry only from the industries list, and filters by it", async () => {
    const unknown = await call("organisation_create", {
      name: "Rocket Co",
      industry: "aerospace",
    });
    const made = await call("organisation_create", {
      name: "Corner Shop",
      industry: "retail",
    });
    const listed = await server.pipeline.query(
      crm.registry.get("organisation_list") as AnyQueryDefinition,
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
    const buyer = await call("organisation_create", { name: "Buyer" });
    const startWon = await call("deal_create", {
      name: "Already won",
      organisation: buyer.output?.record.id,
      stage: "won",
    });
    const made = await call("deal_create", {
      name: "New logo",
      organisation: buyer.output?.record.id,
      value: { amount: 5000, currency: "GBP" },
      stage: "lead",
    });
    const id = made.output?.record.id;
    const viaUpdate = await call("deal_update", { id, stage: "won" }, sarahKey);
    const unknown = await call("deal.moveStage", { id, stage: "nope" });
    const lostBare = await call("deal.moveStage", { id, stage: "lost" });
    const moved = await call("deal.moveStage", { id, stage: "qualified" });
    const lost = await call("deal.moveStage", {
      id,
      stage: "lost",
      reason: "They chose someone else",
    });
    const event = await database.db.query.eventLog.findFirst({
      where: (t, { eq }) => eq(t.runId, moved.runId),
    });
    const history = await server.pipeline.query(
      crm.registry.get("record.history") as AnyQueryDefinition,
      { object: "deal", id },
      seeded.admin
    );
    const lostDeals = await server.pipeline.query(
      crm.registry.get("deal_list") as AnyQueryDefinition,
      { filter: { stage: { where: { category: "lost" } } } },
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
    expect(lostDeals).toMatchObject({
      ok: true,
      output: { records: [{ id, stage: "lost" }] },
    });
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

  it("keeps Sarah's agent to her own deals, and off their stage, on every surface", async () => {
    const request = (url: string, init: RequestInit = {}) =>
      server.app.request(url, {
        ...init,
        headers: { ...(init.headers as object), ...bearer(sarahKey) },
      });
    const buyer = await call("organisation_create", { name: "Own buyer" });
    const mine = await call(
      "deal_create",
      {
        name: "Sarah's deal",
        organisation: buyer.output?.record.id,
        stage: "lead",
      },
      sarahKey
    );
    const forOthers = await call(
      "deal_create",
      {
        name: "Someone else's",
        organisation: buyer.output?.record.id,
        stage: "lead",
        owner: seeded.admin.actorId,
      },
      sarahKey
    );
    const theirs = await call("deal_create", {
      name: "Admin's deal",
      organisation: buyer.output?.record.id,
      stage: "lead",
    });
    const myId = mine.output?.record.id;
    const theirId = theirs.output?.record.id;
    const list = await request("/deals");
    const listed = (await list.json()) as {
      output: { records: { id: string; owner: string }[] };
    };
    const read = await request(`/deals/${theirId}`);
    const patch = (id: string | undefined, body: unknown) =>
      request(`/deals/${id}`, { method: "PATCH", body: JSON.stringify(body) });
    const restStage = await patch(myId, { stage: "won" });
    const restRenamed = await patch(myId, { name: "Mine" });
    const restTheirs = await patch(theirId, { name: "Taken" });
    const mcpStage = await mcpSurface(request)(
      { name: "deal_update" } as never,
      { id: myId, stage: "won" }
    );
    const movedTheirs = await call(
      "deal.moveStage",
      { id: theirId, stage: "qualified" },
      sarahKey
    );
    const owners = new Set(listed.output.records.map((deal) => deal.owner));
    expect(owners).toStrictEqual(new Set([seeded.sales.actorId]));
    expect({
      forOthers: forOthers.error?.code,
      read: read.status,
      rest: [restStage.status, restRenamed.status, restTheirs.status],
      mcp: mcpStage.body,
      movedTheirs: movedTheirs.error?.code,
    }).toMatchObject({
      forOthers: "permission",
      read: 404,
      // Stage isn't hers to write; renaming her own deal is; theirs isn't hers.
      rest: [400, 200, 403],
      mcp: { code: "validation" },
      movedTheirs: "not_found",
    });
  });

  it("lets a manager hire into sales, but not give anyone admin", async () => {
    const mo = await server.db.query.actors.findFirst({
      where: (t, { eq }) => eq(t.name, "Mo Manager"),
    });
    const manager = { actorId: mo?.id ?? "", originUserId: mo?.userId ?? null };
    const invite = (email: string, roles: string[]) =>
      server.pipeline.run(
        crm.registry.get("user.invite") as never,
        { name: email, email, roles },
        manager
      );
    const hired = await invite("rep@example.com", ["sales"]);
    const promoted = await invite("boss@example.com", ["admin"]);
    expect(hired.ok).toBeTruthy();
    expect(promoted).toMatchObject({
      ok: false,
      error: { code: "permission" },
    });
  });

  /** A request as the seeded agent, as an MCP client sends it. */
  const asAgent = (url: string, init: RequestInit = {}) =>
    server.app.request(url, {
      ...init,
      headers: {
        ...bearer(seeded.agentKey),
        accept: "application/json, text/event-stream",
        "mcp-protocol-version": "2025-06-18",
      },
    });

  /** One MCP JSON-RPC call as the seeded agent. */
  const rpc = async (method: string, params?: unknown) => {
    const response = await asAgent("/mcp", {
      method: "POST",
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
    });
    return (await response.json()) as {
      result?: { tools?: { name: string }[]; isError?: boolean };
      error?: { message: string };
    };
  };

  it("keeps the actions workflow steps run off HTTP and MCP", async () => {
    const hidden = [...crm.stepActions.keys()].filter(
      (name) => !crm.registry.get(name)
    );
    const statuses = await Promise.all(
      hidden.flatMap((name) => [
        asAgent(`/actions/${name}`, { method: "POST", body: "{}" }),
        asAgent(`/queries/${name}`, { method: "POST", body: "{}" }),
      ])
    );
    const listed = await rpc("tools/list");
    const called = await rpc("tools/call", {
      name: "within_limit",
      arguments: { value: 1, max: 2 },
    });
    expect(hidden).toStrictEqual(
      expect.arrayContaining([
        "record_belongs_to_caller",
        "within_limit",
        "record_in_state",
      ])
    );
    expect(new Set(statuses.map((response) => response.status))).toStrictEqual(
      new Set([404])
    );
    const workflows = new Set(
      (server.config.service.workflows ?? []).map((workflow) => workflow.key)
    );
    expect(
      (listed.result?.tools ?? []).filter(
        (tool) => hidden.includes(tool.name) && !workflows.has(tool.name)
      )
    ).toStrictEqual([]);
    expect(called.error ?? called.result?.isError).toBeTruthy();
    expect(listed.result?.tools?.length).toBeGreaterThan(0);
  });

  it("moves a contact only through contact.moveToOrganisation", async () => {
    const [from, to] = await Promise.all([
      call("organisation_create", { name: "From" }),
      call("organisation_create", { name: "To" }),
    ]);
    const made = await call("contact_create", {
      firstName: "Mover",
      organisation: from.output?.record.id,
      active: true,
    });
    const id = made.output?.record.id;
    const viaUpdate = await call(
      "contact_update",
      { id, organisation: to.output?.record.id },
      sarahKey
    );
    const moved = await call("contact.moveToOrganisation", {
      id,
      organisation: to.output?.record.id,
    });
    const event = await database.db.query.eventLog.findFirst({
      where: (t, { eq }) => eq(t.runId, moved.runId),
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
  it("gives the same results and log rows over REST, /actions and MCP", async () => {
    const caller = seeded.admin;
    const request = (url: string, init: RequestInit) =>
      server.app.request(url, {
        ...init,
        headers: { ...(init.headers as object), ...bearer(seeded.agentKey) },
      });
    const run = (name: string, input: unknown) => {
      const action = crm.registry.get(name);
      return action && action.kind !== "query"
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
      surfaces: {
        rest: restSurface(request, crm.endpoints),
        http: httpSurface(request),
        mcp: mcpSurface(request),
      },
      samples: {
        ...identitySamples(crm.registry, server.pipeline, caller),
        ...configSamples(),
        deal_create: async () => {
          const org = await run("organisation_create", { name: "Buyer" });
          return {
            name: "Sample deal",
            organisation:
              org.ok && (org.output as { record: { id: string } }).record.id,
            value: { amount: 250_000, currency: "GBP" },
            stage: "lead",
          };
        },
        "deal.moveStage": async () => {
          const org = await run("organisation_create", { name: "Buyer" });
          const created = await run("deal_create", {
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
          const org = await run("organisation_create", { name: "Target" });
          const other = await run("organisation_create", { name: "Start" });
          const person = await run("contact_create", {
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
