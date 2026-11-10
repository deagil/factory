// Workflow endpoints (P2.18): the CRM's deal_move_stage over HTTP and MCP,
// with the same run rows on each, its declared error, retry keys, runs as
// resources, OpenAPI and system_describe.
import type { AnyDefinition } from "@workspace/actions";
import { createServer } from "@workspace/server";
import type { Server } from "@workspace/server";
import {
  createSystemDatabase,
  runWorkflowContract,
  workflowHttpSurface,
  workflowMcpSurface,
} from "@workspace/server/testing";
import type { SystemDatabase } from "@workspace/server/testing";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { seed } from "./seed.ts";
import type { Seeded } from "./seed.ts";
import { crm } from "./system.ts";

describe("workflow endpoints (P2.18)", () => {
  let database: SystemDatabase;
  let server: Server;
  let seeded: Seeded;
  let organisationId = "";

  /** A request as the admin's agent, or as `key`. */
  const request = (path: string, init: RequestInit = {}, key?: string) =>
    server.app.request(path, {
      ...init,
      headers: {
        ...(init.headers as Record<string, string>),
        authorization: `Bearer ${key ?? seeded.agentKey}`,
        "content-type": "application/json",
        accept: "application/json, text/event-stream",
      },
    });

  const post = (path: string, body: unknown, headers = {}) =>
    request(path, { method: "POST", body: JSON.stringify(body), headers });

  /** A new deal in the proposal stage. */
  const newDeal = async () => {
    const created = await server.pipeline.run(
      crm.registry.get("deal_create") as never,
      { name: "Deal", organisation: organisationId, stage: "proposal" },
      seeded.admin
    );
    return (created.ok ? created.output : {}) as { record: { id: string } };
  };

  beforeAll(async () => {
    database = await createSystemDatabase(crm);
    server = await createServer(crm, {
      databaseUrl: database.url,
      authSecret: "a-test-secret-that-is-at-least-32-characters",
      baseURL: "http://localhost:4000",
      log: () => null,
    });
    seeded = await seed(crm, server.db, server.pipeline);
    const listed = await server.pipeline.query(
      crm.registry.get("organisation_list") as AnyDefinition as never,
      {},
      seeded.admin
    );
    const { records } = (listed.ok ? listed.output : {}) as {
      records: { id: string }[];
    };
    organisationId = records[0]?.id ?? "";
  });

  afterAll(async () => {
    await server?.close();
    await database?.close();
  });

  it("writes the same run rows over HTTP and MCP, for a move and for its declared error", async () => {
    const problems = await runWorkflowContract({
      db: server.db,
      surfaces: {
        http: workflowHttpSurface(request),
        mcp: workflowMcpSurface(request),
      },
      cases: [
        {
          name: "won",
          key: "deal_move_stage",
          input: async () => {
            const { record } = await newDeal();
            return { deal: record.id, stage: "won" };
          },
        },
        {
          name: "lost without a reason",
          key: "deal_move_stage",
          input: async () => {
            const { record } = await newDeal();
            return { deal: record.id, stage: "lost" };
          },
        },
      ],
    });
    expect(problems).toStrictEqual([]);
  });

  it("answers a declared error with 422 and its message, and keeps the run", async () => {
    const { record } = await newDeal();
    const response = await post("/workflows/deal_move_stage", {
      deal: record.id,
      stage: "lost",
    });
    const body = (await response.json()) as { runId: string };
    const run = await request(`/runs/${body.runId}`);
    expect([response.status, body]).toMatchObject([
      422,
      {
        error: {
          code: "reason_required",
          message: "A lost deal needs a reason.",
          declared: true,
        },
      },
    ]);
    await expect(run.json()).resolves.toMatchObject({
      output: { run: { status: "failed", endpoint: "deal_move_stage" } },
    });
  });

  it("refuses a retry after the caller loses the workflow", async () => {
    const { record } = await newDeal();
    const made = await server.pipeline.run(
      crm.registry.get("actor.createIntegration") as never,
      { name: "Mover", roles: ["manager"] },
      seeded.admin
    );
    const { actorId } = (made.ok ? made.output : {}) as { actorId: string };
    const keyed = await server.pipeline.run(
      crm.registry.get("apiKey.create") as never,
      { actorId, label: "mover" },
      seeded.admin
    );
    const { key } = (keyed.ok ? keyed.output : {}) as { key: string };
    const input = { deal: record.id, stage: "won" };
    const idem = { "idempotency-key": `lose-${record.id}` };
    const first = await request(
      "/workflows/deal_move_stage",
      { method: "POST", body: JSON.stringify(input), headers: idem },
      key
    );
    const changed = await server.pipeline.run(
      crm.registry.get("actor.setRoles") as never,
      { id: actorId, roles: ["sales"] },
      seeded.admin
    );
    const second = await request(
      "/workflows/deal_move_stage",
      { method: "POST", body: JSON.stringify(input), headers: idem },
      key
    );
    const body = (await second.json()) as {
      replayed?: boolean;
      error?: { code: string };
    };
    expect(first.status).toBe(200);
    expect(changed.ok).toBeTruthy();
    expect(second.status).toBe(403);
    expect(body).toMatchObject({ error: { code: "permission" } });
    expect(body.replayed).toBeUndefined();
  });

  it("replays a retry key, and refuses one used for a different call", async () => {
    const { record } = await newDeal();
    const key = { "idempotency-key": `move-${record.id}` };
    const input = { deal: record.id, stage: "won" };
    const firstResponse = await post("/workflows/deal_move_stage", input, key);
    const first = (await firstResponse.json()) as { runId: string };
    const again = await post("/workflows/deal_move_stage", input, key);
    const other = await post(
      "/workflows/deal_move_stage",
      { ...input, stage: "negotiation" },
      key
    );
    await expect(again.json()).resolves.toMatchObject({
      runId: first.runId,
      replayed: true,
    });
    expect(other.status).toBe(409);
  });

  it("lets only callers whose roles name it call it or see it", async () => {
    const { record } = await newDeal();
    const sarah = await server.pipeline.run(
      crm.registry.get("actor.createAgent") as never,
      { name: "Sarah's agent" },
      seeded.sales
    );
    const { actorId } = (sarah.ok ? sarah.output : {}) as { actorId: string };
    const made = await server.pipeline.run(
      crm.registry.get("apiKey.create") as never,
      { actorId, label: "test" },
      seeded.sales
    );
    const { key } = (made.ok ? made.output : {}) as { key: string };
    const refused = await request(
      "/workflows/deal_move_stage",
      {
        method: "POST",
        body: JSON.stringify({ deal: record.id, stage: "won" }),
      },
      key
    );
    const describedFor = async (as?: string) => {
      const response = await request(
        "/queries/system.describe",
        { method: "POST", body: "{}" },
        as
      );
      const { output } = (await response.json()) as {
        output: { workflows: { key: string }[] };
      };
      return output.workflows.map((workflow) => workflow.key);
    };
    expect(refused.status).toBe(403);
    await expect(describedFor(key)).resolves.toStrictEqual([]);
    await expect(
      describedFor().then((keys) => keys.toSorted())
    ).resolves.toStrictEqual([
      "action_list",
      "deal_follow_up",
      "deal_move_stage",
      "event_list",
      "workflow_get",
      "workflow_list",
      "workflow_validate",
    ]);
  });

  it("lists and reads workflows over HTTP and MCP", async () => {
    const problems = await runWorkflowContract({
      db: server.db,
      surfaces: {
        http: workflowHttpSurface(request),
        mcp: workflowMcpSurface(request),
      },
      cases: [
        { name: "every workflow", key: "workflow_list", input: () => ({}) },
        {
          name: "move stage",
          key: "workflow_get",
          input: () => ({ key: "deal_move_stage" }),
        },
        {
          name: "a step that reads a later step",
          key: "workflow_validate",
          input: () => ({
            key: "deal_new_flow",
            value: JSON.stringify({
              key: "deal_new_flow",
              description: "Reads a step before it has run.",
              starts_when: "called",
              input: { deal: { type: "ref", object: "deal" } },
              steps: [
                {
                  id: "update",
                  action: "deal_update",
                  with: { id: { from: "steps.load.output.record.id" } },
                },
                {
                  id: "load",
                  action: "deal_get",
                  with: { id: { from: "input.deal" } },
                },
              ],
            }),
          }),
        },
      ],
    });
    const listed = await post("/workflows/workflow_list", {});
    const list = (await listed.json()) as {
      output: { workflows: { key: string; starts_when: unknown }[] };
    };
    const query = encodeURIComponent(
      JSON.stringify({ key: "deal_move_stage" })
    );
    const byGet = await request(`/workflows/workflow_get?input=${query}`);
    const byPost = await post("/workflows/workflow_get", {
      key: "deal_move_stage",
    });
    const got = (await byPost.json()) as {
      output: {
        source: string;
        editable: boolean;
        why: string | null;
        revision: string | null;
        definition: { steps: { id?: string }[] };
        check: {
          problems: unknown[];
          warnings: { message: string }[];
          segments: { steps: string[]; ends: unknown }[];
        };
      };
    };
    const code = await post("/workflows/workflow_get", {
      key: "workflow_list",
    });
    const sarah = await server.pipeline.run(
      crm.registry.get("actor.createAgent") as never,
      { name: "Reader" },
      seeded.sales
    );
    const { actorId } = (sarah.ok ? sarah.output : {}) as { actorId: string };
    const made = await server.pipeline.run(
      crm.registry.get("apiKey.create") as never,
      { actorId, label: "reader" },
      seeded.sales
    );
    const { key } = (made.ok ? made.output : {}) as { key: string };
    const refused = await request(
      "/workflows/workflow_list",
      { method: "POST", body: "{}" },
      key
    );
    const refusedBody = (await refused.json()) as { error?: { code: string } };
    const won = list.output.workflows.find(
      (workflow) => workflow.key === "deal_won_task"
    );
    expect({ problems, won, status: byGet.status }).toMatchObject({
      problems: [],
      won: {
        source: "config",
        path: "config/workflows/deal_won_task.yaml",
        starts_when: { event: "deal_stage_changed" },
      },
      status: 200,
    });
    await expect(byGet.json()).resolves.toMatchObject({ output: got.output });
    expect(got.output).toMatchObject({
      source: "config",
      editable: false,
      why: "no_config_remote",
      revision: null,
      definition: {
        steps: [
          { id: "load" },
          { id: "check_reason" },
          { id: "update" },
          { id: "announce" },
        ],
      },
      check: {
        problems: [],
        warnings: [
          {
            message:
              "input.deal takes a deal id, but no step checks it belongs to the caller (record_belongs_to_caller), so anyone who may call this workflow can act on any deal.",
          },
        ],
        segments: [
          {
            steps: ["load", "check_reason", "update", "announce"],
            ends: null,
          },
        ],
      },
    });
    const codeBody = (await code.json()) as { output: unknown };
    expect({
      code: codeBody.output,
      refused: refused.status,
      error: refusedBody.error?.code,
    }).toMatchObject({
      code: { source: "code", editable: false, why: "code", revision: null },
      refused: 403,
      error: "permission",
    });
  });

  it("is POST only, and in the OpenAPI document with its errors", async () => {
    const got = await request("/workflows/deal_move_stage");
    const served = await request("/openapi.json");
    const document = (await served.json()) as {
      paths: Record<string, Record<string, { description: string }>>;
    };
    const operation = document.paths["/workflows/deal_move_stage"];
    expect(got.status).toBe(404);
    expect(Object.keys(operation ?? {})).toStrictEqual(["post"]);
    expect(operation?.post?.description).toContain("`reason_required`");
    expect(
      Object.keys(document.paths["/workflows/workflow_get"] ?? {})
    ).toStrictEqual(["get"]);
  });
});
