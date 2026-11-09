import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createApi } from "./api.ts";
import { createTestApi, endpoints, registry } from "./testing/test-api.ts";
import type { TestApi } from "./testing/test-api.ts";

interface Body {
  output?: Record<string, unknown> & { record?: { id: string } };
  runId?: string | null;
  replayed?: boolean;
  requestId?: string;
  error?: { code: string; message: string };
}

describe("HTTP API", () => {
  let test: TestApi;
  let api: TestApi["api"];
  let key: string;

  beforeAll(async () => {
    test = await createTestApi();
    ({ api } = test);
    key = test.keys.website;
  });

  afterAll(async () => {
    await test?.crm.close();
  });

  const send = async (
    method: string,
    path: string,
    body?: unknown,
    headers: Record<string, string> = {}
  ) => {
    const response = await api.request(path, {
      method,
      headers: {
        authorization: `Bearer ${key}`,
        "content-type": "application/json",
        ...headers,
      },
      body: typeof body === "string" ? body : JSON.stringify(body),
    });
    return {
      status: response.status,
      headers: response.headers,
      body: (await response.json()) as Body,
    };
  };

  it("serves /dev/session only when asked, for local development", async () => {
    const missing = await api.request("/dev/session");
    const dev = createApi({
      registry,
      pipeline: test.pipeline,
      callerFrom: () => Promise.resolve(null),
      devSession: () =>
        Promise.resolve({
          users: [{ name: "Sam", email: "sam@example.com" }],
          outbox: [],
        }),
    });
    const served = await dev.request("/dev/session");
    expect(missing.status).toBe(404);
    await expect(served.json()).resolves.toMatchObject({
      users: [{ email: "sam@example.com" }],
    });
  });

  it("reaches every registered action and query", async () => {
    const routes = await Promise.all(
      registry.list().map(async (definition) => {
        const kind = definition.kind === "action" ? "actions" : "queries";
        const { body } = await send("POST", `/${kind}/${definition.name}`, {});
        return body.error?.message.startsWith("Nothing at") ?? false;
      })
    );
    expect(routes).not.toContain(true);
  });

  it("runs an action with an API key", async () => {
    const { status, body } = await send(
      "POST",
      "/actions/organisation_create",
      {
        name: "Acme",
      }
    );
    expect(status).toBe(200);
    expect(body).toMatchObject({
      output: { record: { name: "Acme" } },
      replayed: false,
      dryRun: false,
    });
    expect(body.runId).toStrictEqual(expect.any(String));
  });

  it("replays a retry key from Idempotency-Key", async () => {
    const headers = { "idempotency-key": "once" };
    const first = await send(
      "POST",
      "/actions/organisation_create",
      { name: "Once" },
      headers
    );
    const second = await send(
      "POST",
      "/actions/organisation_create",
      { name: "Once" },
      headers
    );
    expect(second.body).toMatchObject({
      replayed: true,
      runId: first.body.runId,
    });
  });

  it("serves each object's REST endpoints, with ETag and If-Match", async () => {
    const agent = { authorization: `Bearer ${test.keys.agent}` };
    const created = await send(
      "POST",
      "/organisations",
      { name: "Rest" },
      agent
    );
    const id = created.body.output?.record?.id ?? "";
    const read = await send("GET", `/organisations/${id}`, undefined, agent);
    const stale = await send(
      "PATCH",
      `/organisations/${id}`,
      { name: "Stale" },
      { ...agent, "if-match": '"999"' }
    );
    const etag = read.headers.get("etag") ?? "";
    const patched = await send(
      "PATCH",
      `/organisations/${id}`,
      { name: "Renamed" },
      { ...agent, "if-match": etag }
    );
    const filter = encodeURIComponent(
      JSON.stringify({ name: { eq: "Renamed" } })
    );
    const listed = await send(
      "GET",
      `/organisations?filter=${filter}&limit=5`,
      undefined,
      agent
    );
    const history = await send(
      "GET",
      `/organisations/${id}/history`,
      undefined,
      agent
    );
    expect({
      created: created.status,
      etag,
      stale: [stale.status, stale.body.error?.code],
      patched: patched.body.output?.record,
      listed: listed.body.output?.records,
      history: (history.body.output?.entries as unknown[] | undefined)?.length,
    }).toStrictEqual({
      created: 201,
      etag: '"1"',
      stale: [409, "conflict"],
      patched: expect.objectContaining({ name: "Renamed", version: 2 }),
      listed: [expect.objectContaining({ id })],
      history: 2,
    });
  });

  it("describes the system to any caller, filtered", async () => {
    const { status, body } = await send("GET", "/queries/system.describe");
    expect(status).toBe(200);
    expect(body.output?.objects).toStrictEqual([
      expect.objectContaining({ name: "organisation" }),
    ]);
  });

  it("runs a query by GET with ?input=", async () => {
    const input = encodeURIComponent(JSON.stringify({ limit: 1 }));
    const { status, body } = await send(
      "GET",
      `/queries/organisation_list?input=${input}`
    );
    expect(status).toBe(200);
    expect(body.output).toHaveProperty("records");
  });

  it.each([
    ["validation", 400, "POST", "/actions/organisation_create", {}],
    ["validation", 400, "POST", "/actions/organisation_create", "{not json"],
    [
      "permission",
      403,
      "POST",
      "/actions/organisation_archive",
      { id: crypto.randomUUID() },
    ],
    [
      "not_found",
      404,
      "POST",
      "/queries/organisation_get",
      { id: crypto.randomUUID() },
    ],
    ["not_found", 404, "POST", "/actions/nothing.here", {}],
  ])(
    "maps %s to %i with the error shape",
    async (code, status, method, path, body) => {
      const response = await send(method, path, body, {
        "x-request-id": "req-1",
      });
      expect(response.status).toBe(status);
      expect(response.headers.get("x-request-id")).toBe("req-1");
      expect(response.body).toMatchObject({
        error: { code, message: expect.any(String) },
        runId: expect.toBeOneOf([null, expect.any(String)]),
        requestId: "req-1",
      });
    }
  );

  it("refuses a request with no caller", async () => {
    const response = await send(
      "POST",
      "/actions/organisation_create",
      {},
      {
        authorization: "Bearer fx_wrong",
      }
    );
    expect(response.status).toBe(401);
    expect(response.body.error?.code).toBe("unauthenticated");
  });

  it("serves an OpenAPI document whose references all resolve", async () => {
    const response = await api.request("/openapi.json");
    const document = (await response.json()) as {
      paths: Record<string, Record<string, { operationId: string }>>;
    };
    const text = JSON.stringify(document);
    const refs = [...text.matchAll(/"\$ref":"#\/(?<path>[^"]+)"/gu)].map(
      (match) => match.groups?.path ?? ""
    );
    const resolve = (path: string) => {
      let node: unknown = document;
      for (const part of path.split("/")) {
        node = (node as Record<string, unknown> | undefined)?.[part];
      }
      return node;
    };
    const operationIds = Object.values(document.paths).flatMap((item) =>
      Object.values(item).map((op) => op.operationId)
    );
    expect(refs.filter((ref) => resolve(ref) === undefined)).toStrictEqual([]);
    expect(new Set(operationIds).size).toBe(operationIds.length);
    expect(Object.keys(document.paths)).toHaveLength(
      registry.list().length + new Set(endpoints.map((e) => e.path)).size
    );
  });
});
