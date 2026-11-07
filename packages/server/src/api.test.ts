import {
  createPipeline,
  createRegistry,
  generateDefinitions,
  rolePermissions,
} from "@workspace/actions";
import type { Role } from "@workspace/actions";
import { createAuth, identityActions } from "@workspace/auth";
import { actorRoles } from "@workspace/db";
import {
  contact,
  createCrmDatabase,
  createStaffActor,
  organisation,
} from "@workspace/objects/testing";
import type { CrmDatabase } from "@workspace/objects/testing";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createApi } from "./api.ts";
import type { Api } from "./api.ts";

const roles: Role[] = [
  {
    key: "admin",
    label: "Admin",
    permissions: [
      {
        object: "*",
        can: ["view", "create", "update", "archive"],
        scope: "all",
      },
      { action: "*", scope: "all" },
    ],
  },
  {
    key: "website",
    label: "Website",
    permissions: [
      { object: "organisation", can: ["view", "create"], scope: "all" },
    ],
  },
];

const registry = createRegistry([
  ...identityActions,
  ...generateDefinitions(organisation),
  ...generateDefinitions(contact),
]);

interface Body {
  output?: Record<string, unknown> & { record?: { id: string } };
  actionId?: string | null;
  replayed?: boolean;
  requestId?: string;
  error?: { code: string; message: string };
}

describe("HTTP API", () => {
  let crm: CrmDatabase;
  let api: Api;
  let key: string;

  beforeAll(async () => {
    crm = await createCrmDatabase();
    const config = { sha: null, roles };
    const pipeline = createPipeline({
      db: crm.db,
      config,
      clock: { now: () => new Date() },
      permissions: rolePermissions({ db: crm.db, config }),
    });
    const auth = createAuth({
      db: crm.db,
      secret: "a-test-secret-that-is-at-least-32-characters",
      baseURL: "http://localhost:3000",
    });
    const boss = await createStaffActor(crm.db, "Boss");
    await crm.db
      .insert(actorRoles)
      .values({ actorId: boss.id, roleKey: "admin" });
    const integration = await pipeline.run(
      registry.get("actor.createIntegration") as never,
      { name: "Website", roles: ["website"] },
      { actorId: boss.id }
    );
    const created = await pipeline.run(
      registry.get("apiKey.create") as never,
      {
        actorId: integration.ok
          ? (integration.output as { actorId: string }).actorId
          : "",
        label: "site",
      },
      { actorId: boss.id }
    );
    key = created.ok ? (created.output as { key: string }).key : "";
    api = createApi({
      registry,
      pipeline,
      callerFrom: auth.callerFrom,
      authHandler: auth.auth.handler,
    });
  });

  afterAll(async () => {
    await crm?.close();
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
      "/actions/organisation.create",
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
    expect(body.actionId).toStrictEqual(expect.any(String));
  });

  it("replays a retry key from Idempotency-Key", async () => {
    const headers = { "idempotency-key": "once" };
    const first = await send(
      "POST",
      "/actions/organisation.create",
      { name: "Once" },
      headers
    );
    const second = await send(
      "POST",
      "/actions/organisation.create",
      { name: "Once" },
      headers
    );
    expect(second.body).toMatchObject({
      replayed: true,
      actionId: first.body.actionId,
    });
  });

  it("runs a query by GET with ?input=", async () => {
    const input = encodeURIComponent(JSON.stringify({ limit: 1 }));
    const { status, body } = await send(
      "GET",
      `/queries/organisation.list?input=${input}`
    );
    expect(status).toBe(200);
    expect(body.output).toHaveProperty("records");
  });

  it.each([
    ["validation", 400, "POST", "/actions/organisation.create", {}],
    ["validation", 400, "POST", "/actions/organisation.create", "{not json"],
    [
      "permission",
      403,
      "POST",
      "/actions/organisation.archive",
      { id: crypto.randomUUID() },
    ],
    [
      "not_found",
      404,
      "POST",
      "/queries/organisation.get",
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
        actionId: expect.toBeOneOf([null, expect.any(String)]),
        requestId: "req-1",
      });
    }
  );

  it("refuses a request with no caller", async () => {
    const response = await send(
      "POST",
      "/actions/organisation.create",
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
    expect(Object.keys(document.paths)).toHaveLength(registry.list().length);
  });
});
