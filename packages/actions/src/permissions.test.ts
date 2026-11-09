import { actorRoles } from "@workspace/db";
import {
  contact,
  createCrmDatabase,
  createStaffActor,
  organisation,
} from "@workspace/objects/testing";
import type { CrmDatabase } from "@workspace/objects/testing";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { z } from "zod";

import { defineQuery } from "./define-action.ts";
import { generateDefinitions } from "./generated.ts";
import { rolePermissions, roleSchema } from "./permissions.ts";
import type { Role } from "./permissions.ts";
import { createPipeline } from "./pipeline.ts";
import type { Caller, Pipeline } from "./pipeline.ts";
import { createRegistry } from "./registry.ts";

const roles: Role[] = [
  {
    key: "sales",
    label: "Sales",
    permissions: [
      { object: "organisation", can: ["view", "create"], scope: "all" },
      { action: "report.counts", scope: "all" },
    ],
  },
];

/** A hand-written query that reads both objects. */
const counts = defineQuery({
  name: "report.counts",
  description: "How many organisations and contacts the caller can see",
  input: z.object({}),
  output: z.object({ organisations: z.int(), contacts: z.int() }),
  handler: async (ctx) => {
    const orgs = await ctx.dal.list(organisation, {});
    const people = await ctx.dal.list(contact, {});
    return {
      organisations: orgs.records.length,
      contacts: people.records.length,
    };
  },
});

const registry = createRegistry([
  ...generateDefinitions(organisation),
  ...generateDefinitions(contact),
  counts,
]);

describe("roles and permissions", () => {
  let crm: CrmDatabase;
  let pipeline: Pipeline;
  let sales: Caller;
  let nobody: Caller;

  const call = (name: string, input: unknown, caller: Caller) => {
    const definition = registry.get(name);
    if (!definition) {
      throw new Error(`No ${name}`);
    }
    return definition.kind === "action"
      ? pipeline.run(definition, input, caller)
      : pipeline.query(definition, input, caller);
  };

  beforeAll(async () => {
    crm = await createCrmDatabase();
    const config = { sha: null, roles };
    pipeline = createPipeline({
      db: crm.db,
      config,
      clock: { now: () => new Date("2026-11-07T09:00:00Z") },
      permissions: rolePermissions({ db: crm.db, config }),
    });
    const sarah = await createStaffActor(crm.db, "Sarah");
    const sam = await createStaffActor(crm.db, "Sam");
    await crm.db.insert(actorRoles).values([
      { actorId: sarah.id, roleKey: "sales" },
      // A role config doesn't define grants nothing.
      { actorId: sam.id, roleKey: "retired-role" },
    ]);
    sales = { actorId: sarah.id };
    nobody = { actorId: sam.id };
  });

  afterAll(async () => {
    await crm?.close();
  });

  it("lets an actor do what its roles allow", async () => {
    const created = await call("organisation_create", { name: "Acme" }, sales);
    const listed = await call("organisation_list", {}, sales);
    expect(created.ok).toBeTruthy();
    expect(listed).toMatchObject({
      ok: true,
      output: { records: [{ name: "Acme" }] },
    });
  });

  it("refuses the rest, naming the missing permission and changing nothing", async () => {
    const result = await call(
      "organisation_create",
      { name: "Not allowed" },
      nobody
    );
    const listed = await call("organisation_list", {}, sales);
    expect(result).toMatchObject({
      ok: false,
      error: {
        code: "permission",
        permission: "organisation.create",
        message: "This needs the permission organisation.create",
      },
    });
    expect(
      (listed.ok && (listed.output as { records: unknown[] }).records.length) ||
        0
    ).toBe(1);
  });

  it("checks object verbs and hand-written actions by name", async () => {
    const archive = await call(
      "organisation_archive",
      { id: crypto.randomUUID() },
      sales
    );
    const contacts = await call("contact_list", {}, sales);
    const report = await call("report.counts", {}, nobody);
    expect(archive).toMatchObject({
      error: { permission: "organisation.archive" },
    });
    expect(contacts).toMatchObject({ error: { permission: "contact.view" } });
    expect(report).toMatchObject({ error: { permission: "report.counts" } });
  });

  it("lists nothing of an object the actor can't read", async () => {
    const report = await call("report.counts", {}, sales);
    expect(report).toStrictEqual({
      ok: true,
      output: { organisations: 1, contacts: 0 },
    });
  });

  it("validates roles as config", () => {
    expect(roleSchema.safeParse(roles[0]).success).toBeTruthy();
    expect(
      roleSchema.safeParse({
        key: "x",
        label: "X",
        permissions: [{ object: "deal", can: ["delete"], scope: "own" }],
      }).success
    ).toBeFalsy();
  });
});
