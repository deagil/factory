import { defineObject, f } from "@workspace/objects";
import {
  contact,
  createCrmDatabase,
  createStaffActor,
  organisation,
} from "@workspace/objects/testing";
import type { CrmDatabase } from "@workspace/objects/testing";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { generateDefinitions } from "./generated.ts";
import { createPipeline } from "./pipeline.ts";
import type { Caller, Pipeline } from "./pipeline.ts";
import { createRegistry } from "./registry.ts";

const registry = createRegistry([
  ...generateDefinitions(organisation),
  ...generateDefinitions(contact),
]);

/** A generated definition by name. */
const definition = (name: string) => {
  const found = registry.get(name);
  if (!found) {
    throw new Error(`${name} wasn't generated`);
  }
  return found;
};

describe("generated actions and queries", () => {
  let crm: CrmDatabase;
  let pipeline: Pipeline;
  let caller: Caller;

  /** Runs a generated action or query by name. */
  const call = (name: string, input: unknown) => {
    const found = definition(name);
    return found.kind === "action"
      ? pipeline.run(found, input, caller)
      : pipeline.query(found, input, caller);
  };

  /** Runs a call that must succeed, and returns its output. */
  const output = async (name: string, input: unknown) => {
    const result = await call(name, input);
    if (!result.ok) {
      throw new Error(`${name} failed: ${JSON.stringify(result.error)}`);
    }
    return result.output as Record<string, unknown> & {
      record: Record<string, unknown> & { id: string };
    };
  };

  beforeAll(async () => {
    crm = await createCrmDatabase();
    const actor = await createStaffActor(crm.db, "Sarah");
    caller = { actorId: actor.id };
    pipeline = createPipeline({
      db: crm.db,
      config: { sha: null, roles: [] },
      clock: { now: () => new Date("2026-11-07T09:00:00Z") },
    });
  });

  afterAll(async () => {
    await crm?.close();
  });

  it("generates six definitions per object, and the events", () => {
    expect(registry.list().map((d) => d.name)).toStrictEqual([
      "organisation.create",
      "organisation.update",
      "organisation.archive",
      "organisation.restore",
      "organisation.get",
      "organisation.list",
      "contact.create",
      "contact.update",
      "contact.archive",
      "contact.restore",
      "contact.get",
      "contact.list",
    ]);
    expect(registry.events().map((e) => e.type)).toContain("contact.archived");
  });

  it("creates, gets and lists, emitting <object>.created", async () => {
    const result = await call("organisation.create", {
      name: "Acme",
      customFields: { tier: "gold" },
    });
    const { record } = await output("organisation.get", {
      id: result.ok
        ? (result.output as { record: { id: string } }).record.id
        : "",
    });
    const list = await output("organisation.list", {
      filter: { name: { eq: "Acme" } },
    });
    expect(result).toMatchObject({
      ok: true,
      events: [{ type: "organisation.created", payload: { record } }],
    });
    expect(record).toMatchObject({
      name: "Acme",
      customFields: { tier: "gold" },
    });
    expect(list.records).toStrictEqual([record]);
  });

  it("updates, emitting before and after; a no-op emits nothing", async () => {
    const { record } = await output("organisation.create", { name: "Globex" });
    const changed = await call("organisation.update", {
      id: record.id,
      name: "Globex Corp",
      employees: 40,
    });
    const same = await call("organisation.update", {
      id: record.id,
      name: "Globex Corp",
    });
    expect(changed).toMatchObject({
      ok: true,
      output: { record: { name: "Globex Corp", employees: 40, version: 2 } },
      events: [
        {
          type: "organisation.updated",
          payload: {
            before: { name: "Globex", employees: null },
            after: { name: "Globex Corp", employees: 40 },
          },
        },
      ],
    });
    expect(same).toMatchObject({ ok: true, events: [] });
  });

  it("maps repository outcomes to typed errors", async () => {
    const { record } = await output("organisation.create", { name: "Initech" });
    const missing = await call("organisation.update", {
      id: "00000000-0000-7000-8000-000000000009",
      name: "x",
    });
    const stale = await call("organisation.update", {
      id: record.id,
      name: "Initrode",
      version: 7,
    });
    expect(missing).toMatchObject({ ok: false, error: { code: "not_found" } });
    expect(stale).toMatchObject({ ok: false, error: { code: "conflict" } });
  });

  it("leaves read-only fields out of the update input", async () => {
    const { record: org } = await output("organisation.create", {
      name: "Hooli",
    });
    const { record: ada } = await output("contact.create", {
      firstName: "Ada",
      organisation: org.id,
      active: true,
    });
    const moved = await call("contact.update", {
      id: ada.id,
      organisation: org.id,
    });
    expect(moved).toMatchObject({ ok: false, error: { code: "validation" } });
  });

  it("archives once, emitting <object>.archived, then hides the record", async () => {
    const { record } = await output("organisation.create", {
      name: "Umbrella",
    });
    const first = await call("organisation.archive", { id: record.id });
    const again = await call("organisation.archive", { id: record.id });
    const get = await call("organisation.get", { id: record.id });
    expect(first).toMatchObject({
      ok: true,
      events: [{ type: "organisation.archived" }],
    });
    expect(again).toMatchObject({ ok: true, events: [] });
    expect(get).toMatchObject({ ok: false, error: { code: "not_found" } });
  });

  it("restores an archived record, emitting <object>.restored", async () => {
    const { record } = await output("organisation.create", { name: "Back" });
    await call("organisation.archive", { id: record.id });
    const restored = await call("organisation.restore", { id: record.id });
    const again = await call("organisation.restore", { id: record.id });
    const get = await call("organisation.get", { id: record.id });
    expect(restored).toMatchObject({
      ok: true,
      events: [{ type: "organisation.restored" }],
    });
    expect(again).toMatchObject({ ok: true, events: [] });
    expect(get).toMatchObject({
      ok: true,
      output: { record: { archivedAt: null } },
    });
  });

  it("switches off jobs that are off or owned by a hand-written action", () => {
    const booking = defineObject({
      name: "booking",
      fields: { reference: f.text({ required: true }) },
      actions: { create: "booking.place", archive: false },
    });
    expect(generateDefinitions(booking).map((d) => d.name)).toStrictEqual([
      "booking.update",
      "booking.get",
      "booking.list",
    ]);
  });
});
