// Events and the dispatcher (P2.19): the CRM's deal_won_task and
// deal_owner_task, started by events, a chain stopped at the depth limit,
// and a schedule that starts once a minute however many dispatchers tick.
import { randomUUID } from "node:crypto";

import { pinConfig } from "@workspace/actions";
import { runs } from "@workspace/db/schema";
import { createDispatcher } from "@workspace/events";
import { createServer } from "@workspace/server";
import type { Server } from "@workspace/server";
import { createSystemDatabase } from "@workspace/server/testing";
import type { SystemDatabase } from "@workspace/server/testing";
import {
  defineWorkflow,
  maxDepth,
  workflowEntries,
} from "@workspace/workflows";
import type { WorkflowDefinition } from "@workspace/workflows";
import { and, asc, eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { tasks } from "./objects.ts";
import { seed } from "./seed.ts";
import type { Seeded } from "./seed.ts";
import { crm } from "./system.ts";

/** Started by `ping`, it emits `ping` again: a loop the depth limit stops. */
const pingLoop = defineWorkflow({
  key: "ping_loop",
  description: "Answers every ping with another.",
  starts_when: { event: "ping" },
  events: { ping: {} },
  steps: [{ id: "again", emit: "ping", with: {} }],
});

const nineOClock = defineWorkflow({
  key: "nine_o_clock",
  description: "Lists the tasks at nine every morning.",
  starts_when: { schedule: "0 9 * * *" },
  steps: [{ id: "list", action: "task_list", with: {} }],
});

describe("events and the dispatcher (P2.19)", () => {
  let database: SystemDatabase;
  let server: Server;
  let seeded: Seeded;
  let organisationId = "";

  const call = async (method: string, path: string, body: unknown) => {
    const response = await server.app.request(path, {
      method,
      headers: {
        authorization: `Bearer ${seeded.agentKey}`,
        "content-type": "application/json",
      },
      body: JSON.stringify(body),
    });
    return (await response.json()) as {
      output: { record: { id: string } };
      runId: string;
    };
  };

  const newDeal = async () => {
    const created = await server.pipeline.run(
      crm.registry.get("deal_create") as never,
      { name: "Deal", organisation: organisationId, stage: "proposal" },
      seeded.admin
    );
    return ((created.ok ? created.output : {}) as { record: { id: string } })
      .record.id;
  };

  const tasksOf = (deal: string) =>
    server.db
      .select({ title: tasks.title })
      .from(tasks)
      .where(eq(tasks.deal, deal));

  const runsOf = (endpoint: string) =>
    server.db
      .select()
      .from(runs)
      .where(eq(runs.endpoint, endpoint))
      .orderBy(asc(runs.depth));

  /** A dispatcher that knows only `workflows`. */
  const dispatcherFor = (...workflows: WorkflowDefinition[]) =>
    createDispatcher({
      db: server.db,
      runner: server.workflowCalls.runner,
      clock: { now: () => new Date() },
      config: () => ({
        ...pinConfig(server.config.service),
        workflows: workflowEntries(workflows),
      }),
      log: () => null,
    });

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
      crm.registry.get("organisation_list") as never,
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

  it("adds a task when a deal is won, in a run that links back to the move", async () => {
    const won = await newDeal();
    const lost = await newDeal();
    const move = await call("POST", "/workflows/deal_move_stage", {
      deal: won,
      stage: "won",
    });
    await call("POST", "/workflows/deal_move_stage", {
      deal: lost,
      stage: "lost",
      reason: "Went elsewhere",
    });
    await server.dispatcher.drain();
    const [moveRun] = await server.db
      .select()
      .from(runs)
      .where(eq(runs.id, move.runId));
    const [started] = await server.db
      .select()
      .from(runs)
      .where(
        and(
          eq(runs.endpoint, "deal_won_task"),
          eq(runs.parentRunId, move.runId)
        )
      );
    expect([await tasksOf(won), await tasksOf(lost)]).toStrictEqual([
      [{ title: "Thank the customer" }],
      [],
    ]);
    expect(started).toMatchObject({
      status: "succeeded",
      originUserId: moveRun?.originUserId,
      depth: 1,
    });
    expect(started?.eventId).toBeTruthy();
  });

  it("runs deal_owner_task when the owner changes, and not for other changes", async () => {
    const deal = await newDeal();
    await call("PATCH", `/deals/${deal}`, { name: "Renamed" });
    await server.dispatcher.drain();
    const before = await tasksOf(deal);
    await call("PATCH", `/deals/${deal}`, { owner: seeded.sales.actorId });
    await server.dispatcher.drain();
    // A second drain finds nothing new: each event starts its runs once.
    await server.dispatcher.drain();
    expect([before, await tasksOf(deal)]).toStrictEqual([
      [],
      [{ title: "Introduce the new owner" }],
    ]);
  });

  it("stops a chain of workflows at the depth limit, saying why", async () => {
    await server.workflowCalls.runner.run(
      pingLoop,
      {},
      {
        originUserId: null,
        config: pinConfig(server.config.service),
        start: { event: { id: randomUUID(), payload: {} }, depth: 1 },
      }
    );
    await dispatcherFor(pingLoop).drain();
    const chain = await runsOf("ping_loop");
    const last = chain.at(-1);
    expect(chain.map((run) => run.depth)).toStrictEqual(
      Array.from({ length: maxDepth + 1 }, (_, index) => index + 1)
    );
    expect(last).toMatchObject({
      status: "failed",
      error: {
        code: "conflict",
        message: expect.stringContaining("past the limit"),
      },
    });
  });

  it("starts a scheduled workflow once a minute, however many dispatchers tick", async () => {
    const nine = new Date("2026-11-10T09:00:20Z");
    await dispatcherFor(nineOClock).tick(nine);
    await dispatcherFor(nineOClock).tick(new Date("2026-11-10T09:00:40Z"));
    await dispatcherFor(nineOClock).tick(new Date("2026-11-10T09:01:00Z"));
    const started = await runsOf("nine_o_clock");
    expect(
      started.map((run) => [run.status, run.scheduledFor?.toISOString()])
    ).toStrictEqual([["succeeded", "2026-11-10T09:00:00.000Z"]]);
  });
});
