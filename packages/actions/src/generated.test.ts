import { defineObject, f } from "@workspace/objects";
import {
  contact,
  createCrmDatabase,
  createStaffActor,
  organisation,
} from "@workspace/objects/testing";
import type { CrmDatabase } from "@workspace/objects/testing";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { generateDefinitions, objectEndpoints } from "./generated.ts";
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
    return found.kind === "query"
      ? pipeline.query(found, input, caller)
      : pipeline.run(found, input, caller);
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

  it("generates seven definitions per object, and the events", () => {
    expect(registry.list().map((d) => d.name)).toStrictEqual([
      "organisation_create",
      "organisation_update",
      "organisation_archive",
      "organisation_restore",
      "organisation_get",
      "organisation_list",
      "organisation_history",
      "contact_create",
      "contact_update",
      "contact_archive",
      "contact_restore",
      "contact_get",
      "contact_list",
      "contact_history",
    ]);
    expect(registry.events().map((e) => e.type)).toContain("contact_archived");
  });

  it("creates, gets and lists, emitting <object>.created", async () => {
    const result = await call("organisation_create", {
      name: "Acme",
      customFields: { tier: "gold" },
    });
    const { record } = await output("organisation_get", {
      id: result.ok
        ? (result.output as { record: { id: string } }).record.id
        : "",
    });
    const list = await output("organisation_list", {
      filter: { name: { eq: "Acme" } },
    });
    expect(result).toMatchObject({
      ok: true,
      events: [{ type: "organisation_created", payload: { record } }],
    });
    expect(record).toMatchObject({
      name: "Acme",
      customFields: { tier: "gold" },
    });
    expect(list.records).toStrictEqual([record]);
  });

  it("updates, emitting before and after; a no-op emits nothing", async () => {
    const { record } = await output("organisation_create", { name: "Globex" });
    const changed = await call("organisation_update", {
      id: record.id,
      name: "Globex Corp",
      employees: 40,
    });
    const same = await call("organisation_update", {
      id: record.id,
      name: "Globex Corp",
    });
    expect(changed).toMatchObject({
      ok: true,
      output: { record: { name: "Globex Corp", employees: 40, version: 2 } },
      events: [
        {
          type: "organisation_updated",
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
    const { record } = await output("organisation_create", { name: "Initech" });
    const missing = await call("organisation_update", {
      id: "00000000-0000-7000-8000-000000000009",
      name: "x",
    });
    const stale = await call("organisation_update", {
      id: record.id,
      name: "Initrode",
      version: 7,
    });
    expect(missing).toMatchObject({ ok: false, error: { code: "not_found" } });
    expect(stale).toMatchObject({ ok: false, error: { code: "conflict" } });
  });

  it("archives once, emitting <object>.archived, then hides the record", async () => {
    const { record } = await output("organisation_create", {
      name: "Umbrella",
    });
    const first = await call("organisation_archive", { id: record.id });
    const again = await call("organisation_archive", { id: record.id });
    const get = await call("organisation_get", { id: record.id });
    expect(first).toMatchObject({
      ok: true,
      events: [{ type: "organisation_archived" }],
    });
    expect(again).toMatchObject({ ok: true, events: [] });
    expect(get).toMatchObject({ ok: false, error: { code: "not_found" } });
  });

  it("restores an archived record, emitting <object>.restored", async () => {
    const { record } = await output("organisation_create", { name: "Back" });
    await call("organisation_archive", { id: record.id });
    const restored = await call("organisation_restore", { id: record.id });
    const again = await call("organisation_restore", { id: record.id });
    const get = await call("organisation_get", { id: record.id });
    expect(restored).toMatchObject({
      ok: true,
      events: [{ type: "organisation_restored" }],
    });
    expect(again).toMatchObject({ ok: true, events: [] });
    expect(get).toMatchObject({
      ok: true,
      output: { record: { archivedAt: null } },
    });
  });

  it("switches off jobs, and their endpoints, that are off or owned by a hand-written action", () => {
    const booking = defineObject({
      name: "booking",
      fields: { reference: f.text({ required: true }) },
      actions: { create: "booking.place", archive: false },
    });
    expect(generateDefinitions(booking).map((d) => d.name)).toStrictEqual([
      "booking_update",
      "booking_get",
      "booking_list",
      "booking_history",
    ]);
    expect(
      objectEndpoints(booking).map((e) => `${e.method} ${e.path} ${e.name}`)
    ).toStrictEqual([
      "GET /bookings booking_list",
      "GET /bookings/{id} booking_get",
      "PATCH /bookings/{id} booking_update",
      "GET /bookings/{id}/history booking_history",
    ]);
  });
});
