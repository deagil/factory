import { actorRoles, actors, createIdentityStore } from "@workspace/db";
import {
  createCrmDatabase,
  createStaffActor,
} from "@workspace/objects/testing";
import type { CrmDatabase } from "@workspace/objects/testing";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import type { AnyDefinition } from "./define-action.ts";
import {
  actorGet,
  actorList,
  apiKeyList,
  roleList,
} from "./identity-queries.ts";
import { rolePermissions } from "./permissions.ts";
import type { Role } from "./permissions.ts";
import { createPipeline } from "./pipeline.ts";
import type { Pipeline } from "./pipeline.ts";

const roles: Role[] = [
  {
    key: "admin",
    label: "Admin",
    permissions: [{ action: "*", scope: "all" }],
  },
  {
    key: "sales",
    label: "Sales",
    permissions: [{ object: "organisation", can: ["view"], scope: "all" }],
  },
];

describe("identity queries", () => {
  let crm: CrmDatabase;
  let pipeline: Pipeline;
  let admin: { actorId: string };
  let sam: { actorId: string };
  let agentId = "";
  let integrationId = "";

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
    const [agent, integration] = await crm.db
      .insert(actors)
      .values([
        { kind: "agent", name: "Claude", userId: sales.userId },
        { kind: "integration", name: "Website" },
      ])
      .returning();
    agentId = agent?.id ?? "";
    integrationId = integration?.id ?? "";
    await crm.db.insert(actorRoles).values([
      { actorId: boss.id, roleKey: "admin" },
      { actorId: sales.id, roleKey: "sales" },
      { actorId: integrationId, roleKey: "sales" },
    ]);
    const identity = createIdentityStore(crm.db);
    await identity.createApiKey({ actorId: agentId, label: "Laptop" });
    await identity.createApiKey({ actorId: integrationId, label: "Site" });
    admin = { actorId: boss.id };
    sam = { actorId: sales.id };
  });

  afterAll(async () => {
    await crm?.close();
  });

  it("lists every actor for the admin, by kind, with roles and user", async () => {
    const { output } = await query<{
      entries: { name: string; roles: string[]; user: object | null }[];
    }>(actorList, { kind: "integration" }, admin);
    expect(output?.entries).toStrictEqual([
      expect.objectContaining({
        name: "Website",
        roles: ["sales"],
        user: null,
      }),
    ]);
    const staff = await query<{ entries: { user: { email: string } }[] }>(
      actorList,
      { kind: "staff" },
      admin
    );
    expect(
      staff.output?.entries.map((entry) => entry.user.email)
    ).toStrictEqual(["sam@example.com", "admin@example.com"]);
  });

  it("shows anyone without the permission only their own actors", async () => {
    const { output } = await query<{ entries: { name: string }[] }>(
      actorList,
      {},
      sam
    );
    expect(output?.entries.map((entry) => entry.name)).toStrictEqual([
      "Claude",
      "Sam",
    ]);
  });

  it("gets an actor with its keys, never the hash, and refuses others'", async () => {
    const { output } = await query<{ actor: { keys: object[] } }>(
      actorGet,
      { id: agentId },
      sam
    );
    expect(output?.actor.keys).toStrictEqual([
      {
        id: expect.any(String),
        label: "Laptop",
        at: expect.any(String),
        lastUsedAt: null,
        revokedAt: null,
      },
    ]);
    const refused = await query(actorGet, { id: integrationId }, sam);
    expect(refused.code).toBe("permission");
  });

  it("lists keys for the admin or the agent's own person", async () => {
    const own = await query<{ keys: { label: string }[] }>(
      apiKeyList,
      { actorId: agentId },
      sam
    );
    expect(own.output?.keys.map((key) => key.label)).toStrictEqual(["Laptop"]);
    const refused = await query(apiKeyList, { actorId: integrationId }, sam);
    expect(refused.code).toBe("permission");
    const all = await query<{ keys: object[] }>(
      apiKeyList,
      { actorId: integrationId },
      admin
    );
    expect(all.output?.keys).toHaveLength(1);
  });

  it("lists roles with the permission only", async () => {
    const { output } = await query<{ roles: { key: string }[] }>(
      roleList,
      {},
      admin
    );
    expect(output?.roles.map((role) => role.key)).toStrictEqual([
      "admin",
      "sales",
    ]);
    const refused = await query(roleList, {}, sam);
    expect(refused.code).toBe("permission");
  });
});
