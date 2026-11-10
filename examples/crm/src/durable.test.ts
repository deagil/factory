// Durable runs (P2.20): payment_make charges a fake bank, waits, captures
// and records the payment. It survives a restart during its wait; a
// temporary failure is tried again with the same retry key and charges
// once; a declined capture runs payment_reverse; a reversal that fails too
// leaves the run in the sales inbox, where retrying it finishes it; and a
// notification is sent only once its segment commits.
import { randomUUID } from "node:crypto";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";

import { defineAction } from "@workspace/actions";
import type { Caller } from "@workspace/actions";
import { closeDb, createDb } from "@workspace/db";
import type { Db } from "@workspace/db";
import { runSteps, runs } from "@workspace/db/schema";
import { createServer, defineSystem } from "@workspace/server";
import type { Server } from "@workspace/server";
import { createSystemDatabase } from "@workspace/server/testing";
import type { SystemDatabase } from "@workspace/server/testing";
import { defineWorkflow } from "@workspace/workflows";
import { asc, eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { z } from "zod";

import { createDeal } from "./create-deal.ts";
import { moveStage } from "./move-stage.ts";
import { moveToOrganisation } from "./move-to-organisation.ts";
import { contact, deal, organisation, task, tasks } from "./objects.ts";
import { seed } from "./seed.ts";
import type { Seeded } from "./seed.ts";

/** The outside system: a bank that keys its charges by retry key. */
const bank = {
  charges: new Map<string, { id: string; reversed: boolean }>(),
  /** Charge, then lose this many replies: the caller can't tell it worked. */
  lostReplies: 0,
  declineCapture: false,
  refuseReversal: false,
  /** Each notification, and whether its deal's task was committed by then. */
  notified: [] as { deal: string; committed: boolean }[],
};

/** A pool of its own, to see only what is committed. */
let outside: Db;

const paymentCharge = defineAction({
  name: "payment_charge",
  kind: "external",
  description: "Charge the bank for a deal.",
  input: z.strictObject({ deal: z.uuid(), amount: z.number() }),
  output: z.strictObject({ charge_id: z.string() }),
  handler: (ctx) => {
    const charge = bank.charges.get(ctx.retryKey) ?? {
      id: randomUUID(),
      reversed: false,
    };
    bank.charges.set(ctx.retryKey, charge);
    if (bank.lostReplies > 0) {
      bank.lostReplies -= 1;
      return ctx.unavailable("The bank didn't answer in time.");
    }
    return { charge_id: charge.id };
  },
});

const paymentCapture = defineAction({
  name: "payment_capture",
  kind: "external",
  description: "Capture a charge.",
  input: z.strictObject({ charge_id: z.string() }),
  output: z.strictObject({ note: z.string() }),
  errors: { declined: "The bank declined the capture." },
  handler: (ctx, { charge_id: id }) =>
    bank.declineCapture
      ? ctx.fail("declined")
      : { note: `Payment ${id.slice(0, 8)} taken` },
});

const paymentReverse = defineAction({
  name: "payment_reverse",
  kind: "external",
  description: "Reverse a charge.",
  input: z.strictObject({ charge_id: z.string() }),
  output: z.strictObject({ reversed: z.boolean() }),
  errors: { refused: "The bank refused the reversal." },
  handler: (ctx, { charge_id: id }) => {
    if (bank.refuseReversal) {
      return ctx.fail("refused");
    }
    for (const charge of bank.charges.values()) {
      charge.reversed ||= charge.id === id;
    }
    return { reversed: true };
  },
});

const notifySend = defineAction({
  name: "notify_send",
  kind: "external",
  description: "Tell the deal's owner.",
  input: z.strictObject({ deal: z.uuid() }),
  output: z.strictObject({ sent: z.boolean() }),
  handler: async (_ctx, { deal: id }) => {
    const found = await outside
      .select({ id: tasks.id })
      .from(tasks)
      .where(eq(tasks.deal, id));
    bank.notified.push({ deal: id, committed: found.length > 0 });
    return { sent: true };
  },
});

const paymentMake = defineWorkflow({
  key: "payment_make",
  description: "Charge for a deal, hold it a moment, then capture it.",
  starts_when: "called",
  attention_role: "sales",
  input: {
    deal: { type: "ref", object: "deal" },
    amount: { type: "number" },
  },
  // Later steps can fail after a commit. Capture undoes the charge; the
  // rest keep what already committed (`leave`). A workflow-level list
  // can't read a step output, because it may run before that step has.
  on_failure: "leave",
  steps: [
    {
      id: "charge",
      action: "payment_charge",
      with: { deal: { from: "input.deal" }, amount: { from: "input.amount" } },
    },
    { id: "hold", wait: { for: "1s" } },
    {
      id: "still_open",
      action: "record_in_state",
      with: {
        object: { value: "deal" },
        id: { from: "input.deal" },
        field: { value: "stage" },
        is: { value: "proposal" },
      },
    },
    {
      id: "capture",
      action: "payment_capture",
      with: { charge_id: { from: "steps.charge.output.charge_id" } },
      on_failure: [
        {
          id: "reverse",
          action: "payment_reverse",
          with: { charge_id: { from: "steps.charge.output.charge_id" } },
        },
      ],
    },
    {
      id: "record",
      action: "task_create",
      with: {
        title: { from: "steps.capture.output.note" },
        deal: { from: "input.deal" },
      },
    },
    {
      id: "tell",
      action: "notify_send",
      with: { deal: { from: "input.deal" } },
    },
  ],
  output: { charge_id: { from: "steps.charge.output.charge_id" } },
});

/** Queues a notification, then fails in the same segment. */
const notifyThenFail = defineWorkflow({
  key: "notify_then_fail",
  description: "Records a task and tells the owner, then gives up.",
  starts_when: "called",
  input: { deal: { type: "ref", object: "deal" } },
  errors: { gave_up: "It gave up." },
  steps: [
    {
      id: "record",
      action: "task_create",
      with: { title: { value: "Never kept" }, deal: { from: "input.deal" } },
    },
    {
      id: "tell",
      action: "notify_send",
      with: { deal: { from: "input.deal" } },
      // It is sent only if this segment commits. The next step stops that.
      on_failure: "leave",
    },
    { fail: "gave_up" },
  ],
});

const system = defineSystem({
  name: "example-crm",
  objects: [organisation, contact, deal, task],
  actions: [moveToOrganisation, createDeal, moveStage],
  stepActions: [paymentCharge, paymentCapture, paymentReverse, notifySend],
  workflows: [paymentMake, notifyThenFail],
  migrations: path.resolve(import.meta.dirname, "../migrations"),
  config: path.resolve(import.meta.dirname, "../config"),
});

describe("durable runs (P2.20)", { timeout: 30_000 }, () => {
  let database: SystemDatabase;
  let server: Server;
  let seeded: Seeded;
  let organisationId = "";

  const start = () =>
    createServer(system, {
      databaseUrl: database.url,
      authSecret: "a-test-secret-that-is-at-least-32-characters",
      baseURL: "http://localhost:4000",
      log: () => null,
      durable: true,
      retries: { attempts: 3, firstDelayMs: 20 },
      waitMs: 5000,
    });

  const newDeal = async () => {
    const created = await server.pipeline.run(
      system.registry.get("deal_create") as never,
      { name: "Deal", organisation: organisationId, stage: "proposal" },
      seeded.admin
    );
    return ((created.ok ? created.output : {}) as { record: { id: string } })
      .record.id;
  };

  const pay = (dealId: string, caller: Caller = seeded.admin) =>
    server.workflowCalls.call(
      "payment_make",
      { deal: dealId, amount: 120 },
      caller
    );

  /** The run once it has stopped running or waiting. */
  const settled = async (runId: string) => {
    for (let tries = 0; tries < 150; tries += 1) {
      // oxlint-disable-next-line eslint/no-await-in-loop -- polling
      const [row] = await server.db
        .select()
        .from(runs)
        .where(eq(runs.id, runId));
      if (row && row.status !== "running" && row.status !== "waiting") {
        return row;
      }
      // oxlint-disable-next-line eslint/no-await-in-loop -- polling
      await delay(100);
    }
    throw new Error(`Run ${runId} didn't settle.`);
  };

  const stepsOf = (runId: string) =>
    server.db
      .select()
      .from(runSteps)
      .where(eq(runSteps.runId, runId))
      .orderBy(asc(runSteps.startedAt));

  const runIdOf = (result: Awaited<ReturnType<typeof pay>>) =>
    result.runId ?? "";

  beforeAll(async () => {
    database = await createSystemDatabase(system);
    outside = createDb(database.url);
    server = await start();
    seeded = await seed(system, server.db, server.pipeline);
    const listed = await server.pipeline.query(
      system.registry.get("organisation_list") as never,
      {},
      seeded.admin
    );
    const { records } = (listed.ok ? listed.output : {}) as {
      records: { id: string }[];
    };
    organisationId = records[0]?.id ?? "";
  });

  beforeEach(() => {
    Object.assign(bank, {
      lostReplies: 0,
      declineCapture: false,
      refuseReversal: false,
    });
  });

  afterAll(async () => {
    await server?.close();
    await closeDb(outside);
    await database?.close();
  });

  it("survives a restart during its wait", async () => {
    const dealId = await newDeal();
    const result = await pay(dealId);
    expect(result).toMatchObject({ ok: true, pending: "waiting" });
    await server.close();
    server = await start();
    const run = await settled(runIdOf(result));
    const record = await server.db
      .select({ title: tasks.title })
      .from(tasks)
      .where(eq(tasks.deal, dealId));
    // The notification went once the task it mentions was committed.
    expect({
      status: run.status,
      reversed: bank.charges.get(`${run.id}:charge`)?.reversed ?? null,
      titles: record.map((row) => row.title),
      told: bank.notified.some(
        (each) => each.deal === dealId && each.committed
      ),
    }).toStrictEqual({
      status: "succeeded",
      reversed: false,
      titles: [expect.stringContaining("taken")],
      told: true,
    });
    // The trace shows the segments: the charge, the wait, the check and
    // capture after it, then the record and its notification.
    const steps = await stepsOf(run.id);
    expect(
      steps.map(({ stepId, segment }) => `${segment}:${stepId}`)
    ).toStrictEqual([
      "0:charge",
      "1:hold",
      "2:still_open",
      "2:capture",
      "3:record",
      "3:tell",
    ]);
  });

  it("replays a run still waiting when the caller sends its retry key again", async () => {
    const input = { deal: await newDeal(), amount: 120 };
    const first = await server.workflowCalls.call(
      "payment_make",
      input,
      seeded.admin,
      { retryKey: "pay-once" }
    );
    const again = await server.workflowCalls.call(
      "payment_make",
      input,
      seeded.admin,
      { retryKey: "pay-once" }
    );
    expect(again).toStrictEqual({
      ok: true,
      output: null,
      runId: first.runId,
      replayed: true,
      pending: "waiting",
    });
    await settled(runIdOf(first));
    const made = await server.db
      .select({ id: runs.id })
      .from(runs)
      .where(eq(runs.retryKey, "pay-once"));
    expect(made).toHaveLength(1);
  });

  it("tries a temporary failure again with the same retry key, and charges once", async () => {
    bank.lostReplies = 1;
    const result = await pay(await newDeal());
    const run = await settled(runIdOf(result));
    expect(run.status).toBe("succeeded");
    expect(
      [...bank.charges.keys()].filter((key) => key.startsWith(run.id))
    ).toStrictEqual([`${run.id}:charge`]);
    const steps = await stepsOf(run.id);
    const attempts = steps.filter((step) => step.stepId === "charge");
    expect(attempts.map((step) => [step.attempt, step.error])).toStrictEqual([
      [1, expect.objectContaining({ code: "unavailable" })],
      [2, null],
    ]);
  });

  it("runs payment_reverse when the capture is declined", async () => {
    bank.declineCapture = true;
    const dealId = await newDeal();
    const result = await pay(dealId);
    const run = await settled(runIdOf(result));
    expect(run).toMatchObject({
      status: "failed",
      error: expect.objectContaining({ code: "declined" }),
    });
    expect(bank.charges.get(`${run.id}:charge`)?.reversed).toBeTruthy();
    const steps = await stepsOf(run.id);
    expect(steps.map((step) => step.stepId)).toContain("reverse");
  });

  it("puts a run whose failure steps fail in the sales inbox, where a retry finishes it", async () => {
    bank.declineCapture = true;
    bank.refuseReversal = true;
    const result = await pay(await newDeal());
    const run = await settled(runIdOf(result));
    expect(run).toMatchObject({
      status: "needs_attention",
      attentionRole: "sales",
    });
    const inbox = async (caller: Caller) => {
      const listed = await server.pipeline.query(
        system.registry.get("run.needsAttention") as never,
        {},
        caller
      );
      return (
        (listed.ok ? listed.output : { entries: [] }) as {
          entries: { id: string }[];
        }
      ).entries.map((entry) => entry.id);
    };
    const [salesInbox, adminInbox] = await Promise.all([
      inbox(seeded.sales),
      inbox(seeded.admin),
    ]);
    expect({ sales: salesInbox, admin: adminInbox }).toStrictEqual({
      sales: expect.arrayContaining([run.id]),
      admin: expect.not.arrayContaining([run.id]),
    });

    bank.declineCapture = false;
    const salesUser = seeded.sales.originUserId ?? "";
    const retried = await server.workflowCalls.runner.attend(
      run.id,
      "retry",
      { userId: salesUser, holds: (role) => role === "sales" },
      server.workflowCalls.contextOf(server.config.service)
    );
    expect(retried).toMatchObject({ ok: true });
    const finished = await settled(run.id);
    const steps = await stepsOf(run.id);
    expect(finished.status).toBe("succeeded");
    expect(steps.map((step) => step.stepId)).toContain("retry");
  });

  it("sends a queued notification only after its segment commits", async () => {
    const dealId = await newDeal();
    const result = await server.workflowCalls.call(
      "notify_then_fail",
      { deal: dealId },
      seeded.admin
    );
    expect(result).toMatchObject({
      ok: false,
      error: { code: "gave_up" },
    });
    expect(bank.notified.map((each) => each.deal)).not.toContain(dealId);
  });
});
