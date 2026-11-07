import {
  createPipeline,
  createRegistry,
  generateDefinitions,
} from "@workspace/actions";
import type { Caller } from "@workspace/actions";
import {
  createCrmDatabase,
  createStaffActor,
  organisation,
} from "@workspace/objects/testing";
import type { CrmDatabase } from "@workspace/objects/testing";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createTransport } from "./transport.ts";

const registry = createRegistry(generateDefinitions(organisation));

describe("transport prototype", () => {
  let crm: CrmDatabase;
  let app: ReturnType<typeof createTransport>;
  let caller: Caller;

  beforeAll(async () => {
    crm = await createCrmDatabase();
    const pipeline = createPipeline({
      db: crm.db,
      config: { sha: null, roles: [] },
      clock: { now: () => new Date() },
    });
    const staff = await createStaffActor(crm.db);
    caller = { actorId: staff.id };
    app = createTransport({
      registry,
      pipeline,
      callerFrom: (headers) =>
        Promise.resolve(headers.get("authorization") ? caller : null),
    });
  });

  afterAll(async () => {
    await crm?.close();
  });

  const post = (path: string, body: unknown, headers = {}) =>
    app.request(path, {
      method: "POST",
      headers: {
        authorization: "Bearer test",
        "content-type": "application/json",
        ...headers,
      },
      body: JSON.stringify(body),
    });

  /** Sends one JSON-RPC message to the MCP endpoint; returns the reply. */
  const mcp = async (body: unknown) => {
    const response = await post("/mcp", body, {
      accept: "application/json, text/event-stream",
    });
    return response.json();
  };

  it("runs an action over HTTP", async () => {
    const response = await post("/actions/organisation.create", {
      name: "Over HTTP",
    });
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      ok: true,
      output: { record: { name: "Over HTTP" } },
    });
  });

  it("refuses a request with no caller", async () => {
    const response = await app.request("/actions/organisation.create", {
      method: "POST",
      body: "{}",
    });
    expect(response.status).toBe(401);
  });

  it("describes every definition in OpenAPI", async () => {
    const response = await app.request("/openapi.json");
    const document = (await response.json()) as {
      paths: Record<string, unknown>;
    };
    expect(Object.keys(document.paths)).toContain(
      "/actions/organisation.create"
    );
    expect(Object.keys(document.paths)).toContain("/queries/organisation.list");
  });

  it("runs the same action as an MCP tool", async () => {
    const listed = await mcp({ jsonrpc: "2.0", id: 1, method: "tools/list" });
    const called = await mcp({
      jsonrpc: "2.0",
      id: 2,
      method: "tools/call",
      params: { name: "organisation.create", arguments: { name: "Over MCP" } },
    });
    expect(JSON.stringify(listed)).toContain("organisation.create");
    expect(called).toMatchObject({
      result: { structuredContent: { record: { name: "Over MCP" } } },
    });
  });
});
