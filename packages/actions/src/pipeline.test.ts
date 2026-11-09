import { setTimeout as sleep } from "node:timers/promises";

import { approvals, auditLog, eventLog, runs, runSteps } from "@workspace/db";
import {
  createCrmDatabase,
  createStaffActor,
  organisation,
} from "@workspace/objects/testing";
import type { CrmDatabase } from "@workspace/objects/testing";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { z } from "zod";

import { defineAction, defineQuery } from "./define-action.ts";
import { failures } from "./errors.ts";
import { createPipeline } from "./pipeline.ts";
import type { Pipeline } from "./pipeline.ts";

const clock = new Date("2026-11-07T09:00:00Z");
const created = z.object({ id: z.string(), name: z.string() });

/** Creates an organisation, then does whatever `then` says. */
const createOrg = (
  name: string,
  then: "succeed" | "fail" | "throw" | "badOutput" = "succeed"
) =>
  defineAction({
    name,
    description: "Create an organisation",
    input: z.object({ name: z.string().min(1) }),
    output: z.object({ id: z.string() }),
    emits: { "organisation.created": created },
    handler: async (ctx, input) => {
      const org = await ctx.repo.create(organisation, input);
      ctx.emit("organisation.created", { id: org.id, name: org.name });
      if (then === "fail") {
        return ctx.conflict("Changed my mind");
      }
      if (then === "throw") {
        throw new Error("The disk is full");
      }
      return then === "badOutput" ? ({ id: 42 } as never) : { id: org.id };
    },
  });

/** An action that counts its runs and takes a moment over each. */
const slowCreate = (name: string) => {
  const counter = { runs: 0 };
  const action = defineAction({
    name,
    description: "Create an organisation slowly",
    input: z.object({ name: z.string() }),
    output: z.object({ id: z.string() }),
    handler: async (ctx, input) => {
      counter.runs += 1;
      const org = await ctx.repo.create(organisation, input);
      await sleep(100);
      return { id: org.id };
    },
  });
  return { action, counter };
};

describe("the action pipeline", () => {
  let crm: CrmDatabase;
  let pipeline: Pipeline;
  let caller: { actorId: string };
  let userId: string | null;

  const logRows = (name: string) =>
    crm.db.select().from(runs).where(eq(runs.endpoint, name));
  const stepsOf = (runId: string | undefined) =>
    crm.db
      .select()
      .from(runSteps)
      .where(eq(runSteps.runId, runId ?? ""));
  const orgsNamed = async (name: string) => {
    const rows = await crm.db.select().from(organisation.table);
    return rows.filter((row) => row.name === name);
  };

  beforeAll(async () => {
    crm = await createCrmDatabase();
    const actor = await createStaffActor(crm.db, "Sarah");
    caller = { actorId: actor.id };
    ({ userId } = actor);
    pipeline = createPipeline({
      db: crm.db,
      config: { sha: null, roles: [] },
      clock: { now: () => clock },
    });
  });

  afterAll(async () => {
    await crm?.close();
  });

  it("commits the change, its run and step, audit_log and event_log rows together", async () => {
    const result = await pipeline.run(
      createOrg("org.create"),
      { name: "Acme" },
      caller
    );
    const [log] = await logRows("org.create");
    const [org] = await orgsNamed("Acme");
    const audits = await crm.db
      .select()
      .from(auditLog)
      .where(eq(auditLog.runId, log?.id ?? ""));
    const events = await crm.db
      .select()
      .from(eventLog)
      .where(eq(eventLog.runId, log?.id ?? ""));
    const steps = await stepsOf(log?.id);
    expect(result).toMatchObject({ ok: true, output: { id: org?.id } });
    expect(log).toMatchObject({
      actorId: caller.actorId,
      originUserId: userId,
      input: { name: "Acme" },
      output: { id: org?.id },
      status: "succeeded",
      configSha: null,
      finishedAt: clock,
    });
    expect(steps).toMatchObject([
      {
        stepId: "org.create",
        kind: "action",
        name: "org.create",
        input: { name: "Acme" },
        output: { id: org?.id },
      },
    ]);
    expect(audits).toMatchObject([{ stepId: steps[0]?.id }]);
    expect(events).toMatchObject([
      {
        type: "organisation.created",
        payload: { id: org?.id, name: "Acme" },
        originUserId: userId,
        stepId: steps[0]?.id,
        depth: 0,
      },
    ]);
  });

  it("identifies: refuses an unknown actor, writing nothing", async () => {
    const result = await pipeline.run(
      createOrg("org.unknown"),
      { name: "Nobody" },
      { actorId: "00000000-0000-7000-8000-000000000000" }
    );
    expect(result).toMatchObject({
      ok: false,
      runId: null,
      error: { code: "permission" },
    });
    await expect(logRows("org.unknown")).resolves.toHaveLength(0);
  });

  it("validates: refuses bad input with one failed row", async () => {
    const result = await pipeline.run(
      createOrg("org.invalid"),
      { name: "" },
      caller
    );
    const rows = await logRows("org.invalid");
    expect(result).toMatchObject({ ok: false, error: { code: "validation" } });
    expect(rows).toMatchObject([{ status: "failed", input: { name: "" } }]);
  });

  it("authorises: a refusal changes nothing and leaves one failed row", async () => {
    const strict = createPipeline({
      db: crm.db,
      config: { sha: null, roles: [] },
      clock: { now: () => clock },
      permissions: {
        load: () =>
          Promise.resolve({
            authorise: (definition) => failures.forbidden(definition.name),
            canRead: () => "all" as const,
            holds: () => false,
          }),
      },
    });
    const result = await strict.run(
      createOrg("org.forbidden"),
      { name: "Forbidden" },
      caller
    );
    expect(result).toMatchObject({
      ok: false,
      error: { code: "permission", permission: "org.forbidden" },
    });
    await expect(orgsNamed("Forbidden")).resolves.toHaveLength(0);
    await expect(logRows("org.forbidden")).resolves.toHaveLength(1);
  });

  it("approves: a matching rule parks the action as a waiting run", async () => {
    const guarded = createPipeline({
      db: crm.db,
      config: {
        sha: null,
        roles: [],
        approvals: [
          {
            key: "big-customers",
            label: "Big customers",
            action: "org.guarded",
            when: [{ field: "input.name", operator: "eq", value: "Guarded" }],
            approver: "admin",
          },
        ],
      },
      clock: { now: () => clock },
    });
    const result = await guarded.run(
      createOrg("org.guarded"),
      { name: "Guarded" },
      caller
    );
    const waiting = await crm.db
      .select()
      .from(approvals)
      .where(eq(approvals.subjectId, result.runId ?? ""));
    expect({ result, waiting }).toMatchObject({
      result: {
        ok: false,
        error: { code: "approval_required", rule: "big-customers" },
      },
      waiting: [
        { ruleKey: "big-customers", approverRole: "admin", status: "pending" },
      ],
    });
    await expect(logRows("org.guarded")).resolves.toMatchObject([
      { status: "waiting" },
    ]);
    await expect(orgsNamed("Guarded")).resolves.toHaveLength(0);
  });

  it.each([
    ["a typed error", "fail", "conflict", "Changed my mind"],
    ["a thrown error", "throw", "internal", "The disk is full"],
    ["output that doesn't fit", "badOutput", "internal", "doesn't fit"],
  ] as const)(
    "rolls back on %s, leaving one failed row and no events",
    async (_case, then, code, logged) => {
      const name = `org.${then}`;
      const result = await pipeline.run(
        createOrg(name, then),
        { name: `Rolled back ${then}` },
        caller
      );
      const rows = await logRows(name);
      const events = await crm.db
        .select()
        .from(eventLog)
        .where(eq(eventLog.runId, rows[0]?.id ?? ""));
      expect(result).toMatchObject({ ok: false, error: { code } });
      expect(rows).toHaveLength(1);
      expect(rows[0]?.status).toBe("failed");
      expect(JSON.stringify(rows[0]?.error)).toContain(logged);
      expect([
        ...(await orgsNamed(`Rolled back ${then}`)),
        ...events,
      ]).toStrictEqual([]);
    }
  );

  it("runs queries with reads only and no log row", async () => {
    const count = defineQuery({
      name: "org.count",
      description: "Count organisations",
      input: z.object({}),
      output: z.object({ count: z.int() }),
      handler: async (ctx) => {
        const page = await ctx.dal.list(organisation, { limit: 200 });
        return { count: page.records.length };
      },
    });
    const result = await pipeline.query(count, {}, caller);
    expect(result).toStrictEqual({ ok: true, output: { count: 1 } });
    await expect(logRows("org.count")).resolves.toHaveLength(0);
  });

  describe("retry keys", () => {
    it("return the earlier result without running again", async () => {
      const { action, counter } = slowCreate("org.retried");
      const options = { retryKey: "k1" };
      const first = await pipeline.run(
        action,
        { name: "Once" },
        caller,
        options
      );
      const second = await pipeline.run(
        action,
        { name: "Once" },
        caller,
        options
      );
      expect(counter.runs).toBe(1);
      expect(second).toStrictEqual({
        ...first,
        events: [],
        replayed: true,
      });
      await expect(orgsNamed("Once")).resolves.toHaveLength(1);
    });

    it("run the handler once for two concurrent calls", async () => {
      const { action, counter } = slowCreate("org.raced");
      const options = { retryKey: "k2" };
      const [a, b] = await Promise.all([
        pipeline.run(action, { name: "Raced" }, caller, options),
        pipeline.run(action, { name: "Raced" }, caller, options),
      ]);
      expect(counter.runs).toBe(1);
      expect(a?.ok && b?.ok && a.output).toStrictEqual(b?.ok && b.output);
      await expect(orgsNamed("Raced")).resolves.toHaveLength(1);
    });

    it("refuse a key reused for a different input", async () => {
      const { action } = slowCreate("org.reused");
      const options = { retryKey: "k3" };
      await pipeline.run(action, { name: "First" }, caller, options);
      const result = await pipeline.run(
        action,
        { name: "Other" },
        caller,
        options
      );
      expect(result).toMatchObject({ ok: false, error: { code: "conflict" } });
    });
  });

  it("dry runs report what would happen and change nothing but one row", async () => {
    const result = await pipeline.run(
      createOrg("org.dry"),
      { name: "Dry" },
      caller,
      { dryRun: true }
    );
    expect(result).toMatchObject({
      ok: true,
      dryRun: true,
      events: [{ type: "organisation.created" }],
      changes: [{ object: "organisation", before: {}, after: { name: "Dry" } }],
    });
    await expect(orgsNamed("Dry")).resolves.toHaveLength(0);
    await expect(logRows("org.dry")).resolves.toMatchObject([
      { dryRun: true, status: "succeeded" },
    ]);
    const events = await crm.db
      .select()
      .from(eventLog)
      .where(eq(eventLog.runId, result.runId ?? ""));
    expect(events).toStrictEqual([]);
  });
});
