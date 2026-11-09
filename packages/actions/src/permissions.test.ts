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
import {
  beyond,
  everythingRole,
  grantedBy,
  rolePermissions,
  roleSchema,
} from "./permissions.ts";
import type { Role } from "./permissions.ts";
import { createPipeline } from "./pipeline.ts";
import type { Caller, Pipeline } from "./pipeline.ts";
import { createRegistry } from "./registry.ts";

const roles: Role[] = [
  {
    key: "sales",
    label: "Sales",
    objects: {
      organisation: {
        endpoints: ["list", "get", "create", "history"],
        rows: "all",
      },
    },
    workflows: ["report.counts"],
  },
  {
    key: "rep",
    label: "Rep",
    objects: {
      organisation: {
        endpoints: "*",
        rows: "own",
        read: { except: ["website"] },
        write: { except: ["employees"] },
      },
    },
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
  let rep: Caller;

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
    const rita = await createStaffActor(crm.db, "Rita");
    await crm.db.insert(actorRoles).values([
      { actorId: sarah.id, roleKey: "sales" },
      { actorId: rita.id, roleKey: "rep" },
      // A role config doesn't define grants nothing.
      { actorId: sam.id, roleKey: "retired-role" },
    ]);
    sales = { actorId: sarah.id };
    nobody = { actorId: sam.id };
    rep = { actorId: rita.id };
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
        permission: "organisation_create",
        message: "This needs the permission organisation_create",
      },
    });
    expect(
      (listed.ok && (listed.output as { records: unknown[] }).records.length) ||
        0
    ).toBe(1);
  });

  it("checks object endpoints and workflows by name", async () => {
    const archive = await call(
      "organisation_archive",
      { id: crypto.randomUUID() },
      sales
    );
    const contacts = await call("contact_list", {}, sales);
    const report = await call("report.counts", {}, nobody);
    expect(archive).toMatchObject({
      error: { permission: "organisation_archive" },
    });
    expect(contacts).toMatchObject({ error: { permission: "contact_list" } });
    expect(report).toMatchObject({ error: { permission: "report.counts" } });
  });

  it("lists nothing of an object the actor can't read", async () => {
    const report = await call("report.counts", {}, sales);
    expect(report).toStrictEqual({
      ok: true,
      output: { organisations: 1, contacts: 0 },
    });
  });

  it("keeps own rows and field rules on every read and write", async () => {
    const id = (result: Awaited<ReturnType<typeof call>>) =>
      result.ok
        ? String((result.output as { record: { id: string } }).record.id)
        : "";
    const mine = await call(
      "organisation_create",
      { name: "Rita's", website: "rita.example" },
      rep
    );
    const theirs = id(
      await call(
        "organisation_create",
        { name: "Sarah's", owner: sales.actorId },
        sales
      )
    );
    const listed = await call("organisation_list", {}, rep);
    expect({
      mine: mine.ok && (mine.output as { record: object }).record,
      listed: listed.ok && (listed.output as { records: object[] }).records,
      read: await call("organisation_get", { id: theirs }, rep),
      changed: await call(
        "organisation_update",
        { id: theirs, name: "Mine" },
        rep
      ),
      employees: await call(
        "organisation_update",
        { id: id(mine), employees: 3 },
        rep
      ),
      filtered: await call("organisation_list", { sort: "website" }, rep),
      gift: await call(
        "organisation_create",
        { name: "Gift", owner: sales.actorId },
        rep
      ),
    }).toMatchObject({
      mine: expect.not.objectContaining({ website: expect.anything() }),
      listed: [expect.objectContaining({ name: "Rita's", owner: rep.actorId })],
      read: { error: { code: "not_found" } },
      changed: {
        error: {
          code: "permission",
          message: expect.stringContaining("isn't yours"),
        },
      },
      employees: {
        error: {
          code: "validation",
          message: "You can't change Employees on a organisation.",
        },
      },
      filtered: { error: { code: "validation" } },
      gift: { error: { code: "permission" } },
    });
  });

  it("finds what one grant gives beyond another: the privilege ceiling", () => {
    const [salesRole, repRole] = roles as [Role, Role];
    const objects = [organisation, contact];
    const admin = grantedBy([everythingRole]);
    expect([
      beyond(admin, grantedBy([salesRole]), objects),
      beyond(grantedBy([salesRole]), admin, objects),
      beyond(grantedBy([salesRole]), grantedBy([repRole]), objects),
      beyond(grantedBy([repRole]), grantedBy([salesRole]), objects),
    ]).toStrictEqual([
      null,
      "more on organisation records than you have",
      "more on organisation records than you have",
      "more on organisation records than you have",
    ]);
  });

  it("validates roles as config", () => {
    expect(roleSchema.safeParse(roles[0]).success).toBeTruthy();
    expect(
      roleSchema.safeParse({
        key: "x",
        label: "X",
        objects: {
          deal: { endpoints: [], rows: "all" },
        },
      }).success
    ).toBeFalsy();
  });
});
