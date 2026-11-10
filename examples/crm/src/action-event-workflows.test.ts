// action_list and event_list over HTTP and MCP.
import type {
  AnyActionDefinition,
  AnyDefinition,
  Caller,
  GitService,
} from "@workspace/actions";
import { defineAction } from "@workspace/actions";
import { noRemote } from "@workspace/config";
import { createServer } from "@workspace/server";
import type { Server } from "@workspace/server";
import {
  createSystemDatabase,
  runWorkflowContract,
  workflowHttpSurface,
  workflowMcpSurface,
} from "@workspace/server/testing";
import type { SystemDatabase } from "@workspace/server/testing";
import { createRunner, defineWorkflow } from "@workspace/workflows";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { z } from "zod";

import { seed } from "./seed.ts";
import type { Seeded } from "./seed.ts";
import { crm } from "./system.ts";

const outputOf = async (response: Response) =>
  (await response.json()) as {
    output?: {
      actions?: {
        name: string;
        kind: string;
        object?: string;
        read_only?: true;
        input: { type?: string; properties?: Record<string, unknown> };
      }[];
      events?: {
        type: string;
        payload: { kind: string; fields?: Record<string, unknown> };
        from: { kind: string; name: string };
        workflows: string[];
      }[];
    };
    error?: { code: string; message: string };
  };

const gitStub = (): GitService => ({
  production: "production",
  head: () => Promise.reject(new Error("unused")),
  branch: () => Promise.reject(new Error("unused")),
  commit: () => Promise.reject(new Error("unused")),
  diff: () => Promise.reject(new Error("unused")),
  remove: () => Promise.reject(new Error("unused")),
  files: () => Promise.reject(new Error("unused")),
  check: () => Promise.reject(new Error("unused")),
  publish: () => Promise.reject(new Error("unused")),
});

describe("action_list and event_list", () => {
  let database: SystemDatabase;
  let server: Server;
  let seeded: Seeded;

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

  const post = (path: string, body: unknown, key?: string) =>
    request(path, { method: "POST", body: JSON.stringify(body) }, key);

  /** An API key for a new agent of `caller`. */
  const keyFor = async (caller: Caller, name: string) => {
    const made = await server.pipeline.run(
      crm.registry.get("actor.createAgent") as never,
      { name },
      caller
    );
    const { actorId } = (made.ok ? made.output : {}) as { actorId: string };
    const keyed = await server.pipeline.run(
      crm.registry.get("apiKey.create") as never,
      { actorId, label: name },
      caller
    );
    return (keyed.ok ? keyed.output : {}) as { key: string };
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
  });

  afterAll(async () => {
    await server?.close();
    await database?.close();
  });

  it("matches over HTTP and MCP", async () => {
    const problems = await runWorkflowContract({
      db: server.db,
      surfaces: {
        http: workflowHttpSurface(request),
        mcp: workflowMcpSurface(request),
      },
      cases: [
        { name: "actions", key: "action_list", input: () => ({}) },
        { name: "events", key: "event_list", input: () => ({}) },
      ],
    });
    expect(problems).toStrictEqual([]);
  });

  it("lists deal_update and record_belongs_to_caller on GET", async () => {
    const response = await request("/workflows/action_list");
    const body = await outputOf(response);
    const actions = body.output?.actions ?? [];
    const update = actions.find((action) => action.name === "deal_update");
    const check = actions.find(
      (action) => action.name === "record_belongs_to_caller"
    );
    expect(response.status).toBe(200);
    expect(update).toMatchObject({
      kind: "internal",
      object: "deal",
      input: { type: "object" },
    });
    expect(update?.input.properties).toMatchObject({
      id: expect.any(Object),
      stage: expect.any(Object),
    });
    expect(check).toMatchObject({ read_only: true });
    expect(check?.object).toBeUndefined();
  });

  it("shows deal_stage_changed declared by deal_move_stage and starting deal_won_task", async () => {
    const response = await request("/workflows/event_list");
    const body = await outputOf(response);
    const events = body.output?.events ?? [];
    expect(response.status).toBe(200);
    expect(
      events.find((event) => event.type === "deal_stage_changed")
    ).toMatchObject({
      from: { kind: "workflow", name: "deal_move_stage" },
      payload: {
        kind: "fields",
        fields: {
          deal: { type: "ref", object: "deal" },
          to: { type: "choice", list: "deal_stages" },
        },
      },
      workflows: ["deal_won_task"],
    });
    expect(events.find((event) => event.type === "deal_updated")).toMatchObject(
      {
        from: { kind: "object", name: "deal" },
        payload: { kind: "schema" },
        workflows: ["deal_owner_task"],
      }
    );
  });

  it("is GET in OpenAPI, and a sales user cannot call either", async () => {
    const served = await request("/openapi.json");
    const document = (await served.json()) as {
      paths: Record<string, Record<string, unknown>>;
    };
    const { key } = await keyFor(seeded.sales, "Sarah's agent");
    const actions = await post("/workflows/action_list", {}, key);
    const events = await post("/workflows/event_list", {}, key);
    expect(
      Object.keys(document.paths["/workflows/action_list"] ?? {})
    ).toStrictEqual(expect.arrayContaining(["get"]));
    expect(actions.status).toBe(403);
    expect(events.status).toBe(403);
    await expect(outputOf(actions)).resolves.toMatchObject({
      error: { code: "permission" },
    });
  });

  it("lets a manager call them, and refuses a draft when there is no config remote", async () => {
    const listed = await server.pipeline.query(
      crm.registry.get("actor.list") as AnyDefinition as never,
      { kind: "staff" },
      seeded.admin
    );
    const entries = (listed.ok ? listed.output : { entries: [] }) as {
      entries: { id: string; name: string; user: { id: string } | null }[];
    };
    const manager = entries.entries.find(
      (entry) => entry.name === "Mo Manager"
    );
    const { key } = await keyFor(
      {
        actorId: manager?.id ?? "",
        originUserId: manager?.user?.id ?? "",
      },
      "Mo's agent"
    );
    const allowed = await post("/workflows/action_list", {}, key);
    const refused = await post("/workflows/event_list", {
      draft_id: "00000000-0000-7000-8000-000000000099",
    });
    const bad = await post("/workflows/event_list", { draft_id: "nope" });
    expect(manager?.user?.id).toBeTruthy();
    expect(allowed.status).toBe(200);
    expect(refused.status).toBe(400);
    await expect(outputOf(refused)).resolves.toMatchObject({
      error: { code: "validation", message: noRemote },
    });
    expect(bad.status).toBe(400);
  });

  it("passes the config remote through to a step", async () => {
    const seen: { git?: GitService } = {};
    const probe = defineAction({
      name: "probe_git",
      kind: "internal",
      readOnly: true,
      description: "Reports whether this step was given the config remote.",
      input: z.object({}),
      output: z.object({ present: z.boolean() }),
      handler: (ctx) => {
        seen.git = ctx.git;
        return { present: ctx.git !== undefined };
      },
    });
    const actions = new Map<string, AnyActionDefinition>([
      ...crm.stepActions,
      [probe.name, probe],
    ]);
    const runner = createRunner({
      db: server.db,
      actions,
      clock: { now: () => new Date() },
    });
    const remote = gitStub();
    const result = await runner.run(
      defineWorkflow({
        key: "probe_git",
        description: "Probe.",
        starts_when: "called",
        read_only: true,
        output: { present: { from: "steps.probe.output.present" } },
        steps: [{ id: "probe", action: "probe_git" }],
      }),
      {},
      {
        originUserId: null,
        config: { sha: null, roles: [] },
        git: remote,
      }
    );
    expect(result).toMatchObject({ ok: true, output: { present: true } });
    expect(seen.git).toBe(remote);
  });
});
