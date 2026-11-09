import {
  contact,
  createCrmDatabase,
  createStaffActor,
  organisation,
} from "@workspace/objects/testing";
import type { CrmDatabase } from "@workspace/objects/testing";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { z } from "zod";

import { defineAction } from "./define-action.ts";
import type { AnyActionDefinition } from "./define-action.ts";
import { stepActions } from "./record-actions.ts";
import { testAction } from "./testing.ts";
import type { TestActionOptions } from "./testing.ts";

const actions = new Map(
  stepActions([organisation, contact]).map((action) => [action.name, action])
);

const action = (name: string) => actions.get(name) as AnyActionDefinition;

describe("actions workflow steps run (P2.15)", () => {
  let crm: CrmDatabase;
  let as: TestActionOptions;
  let sarahActor = "";

  const run = (name: string, input: unknown, options = as) =>
    testAction(crm.db, action(name), input, options);

  /** An organisation owned by `owner`; returns its id. */
  const organisationOf = async (owner: string | null, name = "Acme") => {
    const made = await run("organisation_create", { name, owner });
    return made.ok ? (made.output as { record: { id: string } }).record.id : "";
  };

  beforeAll(async () => {
    crm = await createCrmDatabase();
    const workflow = await createStaffActor(crm.db, "Workflow");
    const sarah = await createStaffActor(crm.db, "Sarah");
    sarahActor = sarah.id;
    as = { actor: workflow, originUserId: sarah.userId };
  });

  afterAll(async () => {
    await crm?.close();
  });

  it("gives every object internal record actions that write with the service key", async () => {
    const id = await organisationOf(null);
    const updated = await run("organisation_update", { id, employees: 12 });
    const archived = await run("organisation_archive", { id });
    const read = await run("organisation_get", { id, archived: "include" });
    const listed = await run("organisation_list", {});
    const audit = await crm.db.query.auditLog.findMany({
      where: (t, { eq }) => eq(t.recordId, id),
    });
    expect([...actions.values()].map((each) => each.kind)).not.toContain(
      "external"
    );
    expect(updated).toMatchObject({
      ok: true,
      events: [{ type: "organisation_updated" }],
    });
    expect([archived, read, listed]).toMatchObject([
      { ok: true },
      {
        output: {
          record: { id, employees: 12, archivedAt: expect.any(String) },
        },
      },
      { output: { records: [] } },
    ]);
    expect(audit).toHaveLength(3);
  });

  it("checks a record belongs to the caller, a value's limits and a record's state", async () => {
    const mine = await organisationOf(sarahActor, "Mine");
    const theirs = await organisationOf(null, "Theirs");
    const results = await Promise.all([
      run("record_belongs_to_caller", { object: "organisation", id: mine }),
      run("record_belongs_to_caller", { object: "organisation", id: theirs }),
      run("within_limit", { value: 50, max: 100 }),
      run("within_limit", { value: 150, max: 100 }),
      run("within_limit", { value: 5, min: 10 }),
      run("within_limit", { value: 5 }),
      run("record_in_state", {
        object: "organisation",
        id: mine,
        field: "name",
        one_of: ["Mine", "Ours"],
      }),
      run("record_in_state", {
        object: "organisation",
        id: mine,
        field: "name",
        is: "Ours",
      }),
    ]);
    expect(
      results.map((result) => (result.ok ? "ok" : result.error.code))
    ).toStrictEqual([
      "ok",
      "not_yours",
      "ok",
      "over_limit",
      "under_limit",
      "validation",
      "ok",
      "wrong_state",
    ]);
    expect(results.at(-1)).toMatchObject({
      error: { message: 'Name is "Mine", not "Ours".', declared: true },
    });
  });

  it("rolls a failed step back and hands an external action its retry key", async () => {
    const before = await crm.db.query.auditLog.findMany();
    const failing = defineAction({
      name: "make_then_fail",
      kind: "internal",
      description: "Creates an organisation, then fails",
      input: z.object({}),
      output: z.object({}),
      errors: { gave_up: "It gave up." },
      handler: async (ctx) => {
        await ctx.repo.create(organisation, { name: "Gone" });
        return ctx.fail("gave_up");
      },
    });
    const send = defineAction({
      name: "send_note",
      kind: "external",
      description: "Pretends to send a note",
      input: z.object({ to: z.string() }),
      output: z.object({ key: z.string() }),
      handler: (ctx) => ({ key: ctx.retryKey }),
    });
    const failed = await testAction(crm.db, failing, {}, as);
    const after = await crm.db.query.auditLog.findMany();
    const sent = await testAction(crm.db, send, { to: "sam" }, as);
    expect(failed).toMatchObject({
      ok: false,
      error: { code: "gave_up", message: "It gave up." },
    });
    expect(after).toHaveLength(before.length);
    expect(sent).toMatchObject({
      ok: true,
      output: { key: `${sent.runId}:send_note` },
    });
  });

  it("refuses a declared error that isn't snake_case or is built in, and an external action that emits", () => {
    const base = {
      description: "x",
      input: z.object({}),
      output: z.object({}),
      handler: () => ({}),
    };
    expect(() =>
      defineAction({
        ...base,
        name: "a_one",
        kind: "internal",
        errors: { NotSnake: "x" },
      })
    ).toThrow(/snake_case/u);
    expect(() =>
      defineAction({
        ...base,
        name: "a_two",
        kind: "internal",
        errors: { conflict: "x" },
      })
    ).toThrow(/built-in/u);
    expect(() =>
      defineAction({
        ...base,
        name: "a_three",
        kind: "external",
        emits: { a_happened: z.object({}) },
      })
    ).toThrow(/can't emit/u);
  });
});
