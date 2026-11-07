import { actorRoles, actors } from "@workspace/db";
import {
  createCrmDatabase,
  createStaffActor,
  organisation,
} from "@workspace/objects/testing";
import type { CrmDatabase } from "@workspace/objects/testing";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import type { AnyActionDefinition, AnyDefinition } from "./define-action.ts";
import { generateDefinitions } from "./generated.ts";
import {
  actionLogGet,
  actionLogList,
  auditLogList,
  eventLogList,
} from "./logs.ts";
import { rolePermissions } from "./permissions.ts";
import type { Role } from "./permissions.ts";
import { createPipeline } from "./pipeline.ts";
import type { Pipeline } from "./pipeline.ts";

const roles: Role[] = [
  {
    key: "admin",
    label: "Admin",
    permissions: [
      { object: "*", can: ["view", "create", "update"], scope: "all" },
      { action: "*", scope: "all" },
    ],
  },
  {
    key: "sales",
    label: "Sales",
    permissions: [
      { object: "organisation", can: ["view", "create"], scope: "all" },
    ],
  },
];

const [create, update] = generateDefinitions(organisation).filter(
  (definition): definition is AnyActionDefinition =>
    definition.kind === "action"
) as [AnyActionDefinition, AnyActionDefinition];

interface Entry {
  id: string;
  name: string;
  actor: { name: string };
  origin: { name: string } | null;
}

describe("log queries", () => {
  let crm: CrmDatabase;
  let pipeline: Pipeline;
  let admin: { actorId: string };
  let sam: { actorId: string };
  let samsAgent: { actorId: string };
  let acmeId = "";
  let renameId = "";

  const query = async <TOutput>(
    definition: AnyDefinition,
    input: unknown,
    caller: { actorId: string }
  ) => {
    const result = await pipeline.query(definition as never, input, caller);
    return result.ok
      ? { output: result.output as TOutput, code: null }
      : { output: null, code: result.error.code };
  };

  const createOrganisation = async (
    name: string,
    caller: { actorId: string }
  ) => {
    const created = await pipeline.run(create, { name }, caller);
    return created.ok
      ? (created.output as { record: { id: string } }).record.id
      : "";
  };

  beforeAll(async () => {
    crm = await createCrmDatabase();
    const config = { sha: null, roles };
    pipeline = createPipeline({
      db: crm.db,
      config,
      clock: { now: () => new Date() },
      permissions: rolePermissions({ db: crm.db, config }),
    });
    const boss = await createStaffActor(crm.db, "Admin");
    const sales = await createStaffActor(crm.db, "Sam");
    await crm.db.insert(actorRoles).values([
      { actorId: boss.id, roleKey: "admin" },
      { actorId: sales.id, roleKey: "sales" },
    ]);
    const [agent] = await crm.db
      .insert(actors)
      .values({ kind: "agent", name: "Claude", userId: sales.userId })
      .returning();
    admin = { actorId: boss.id };
    sam = { actorId: sales.id };
    samsAgent = { actorId: agent?.id ?? "" };

    acmeId = await createOrganisation("Acme", admin);
    const renamed = await pipeline.run(
      update,
      { id: acmeId, name: "Acme Ltd" },
      admin
    );
    renameId = renamed.ok ? (renamed.actionId ?? "") : "";
    await createOrganisation("Globex", sam);
    await createOrganisation("Initech", samsAgent);
  });

  afterAll(async () => {
    await crm?.close();
  });

  it("lists actions newest first, filtered and paged", async () => {
    const { output } = await query<{ entries: Entry[] }>(
      actionLogList,
      { namePrefix: "organisation." },
      admin
    );
    expect(output?.entries.map((entry) => entry.name)).toStrictEqual([
      "organisation.create",
      "organisation.create",
      "organisation.update",
      "organisation.create",
    ]);
    const first = await query<{ entries: Entry[]; nextCursor: string }>(
      actionLogList,
      { name: "organisation.create", limit: 2 },
      admin
    );
    const second = await query<{ entries: Entry[]; nextCursor: null }>(
      actionLogList,
      {
        name: "organisation.create",
        limit: 2,
        cursor: first.output?.nextCursor,
      },
      admin
    );
    expect(second.output?.entries).toHaveLength(1);
    expect(second.output?.nextCursor).toBeNull();
  });

  it("shows anyone without the permission only their own actions", async () => {
    const { output } = await query<{ entries: Entry[] }>(
      actionLogList,
      {},
      sam
    );
    expect(
      output?.entries.map((entry) => [entry.actor.name, entry.origin?.name])
    ).toStrictEqual([
      ["Claude", "Sam"],
      ["Sam", "Sam"],
    ]);
  });

  it("gets one action with its changes and events, and refuses others'", async () => {
    const { output } = await query<{
      action: { changes: { after: object }[]; events: { type: string }[] };
    }>(actionLogGet, { id: renameId }, admin);
    expect(output?.action.changes.map((change) => change.after)).toStrictEqual([
      { name: "Acme Ltd" },
    ]);
    expect(output?.action.events.map((event) => event.type)).toStrictEqual([
      "organisation.updated",
    ]);
    const refused = await query(actionLogGet, { id: renameId }, sam);
    expect(refused.code).toBe("permission");
  });

  it("lists changes to one field, and needs its permission", async () => {
    const { output } = await query<{
      entries: { recordId: string; action: string }[];
    }>(auditLogList, { field: "name", recordId: acmeId }, admin);
    expect(output?.entries.map((entry) => entry.action)).toStrictEqual([
      "organisation.update",
      "organisation.create",
    ]);
    const refused = await query(auditLogList, {}, sam);
    expect(refused.code).toBe("permission");
  });

  it("lists events by type prefix", async () => {
    const { output } = await query<{ entries: { type: string }[] }>(
      eventLogList,
      { typePrefix: "organisation.upd" },
      admin
    );
    expect(output?.entries.map((entry) => entry.type)).toStrictEqual([
      "organisation.updated",
    ]);
  });
});
