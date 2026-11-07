import {
  createPipeline,
  createRegistry,
  generateDefinitions,
  rolePermissions,
} from "@workspace/actions";
import type { Caller, Pipeline, Role } from "@workspace/actions";
import { actorRoles } from "@workspace/db";
import {
  createCrmDatabase,
  createStaffActor,
  organisation,
} from "@workspace/objects/testing";
import type { CrmDatabase } from "@workspace/objects/testing";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { identityActions } from "./actions.ts";
import { createAuth } from "./auth.ts";
import type { Auth } from "./auth.ts";

const roles: Role[] = [
  {
    key: "sales",
    label: "Sales",
    permissions: [
      { object: "organisation", can: ["view", "create"], scope: "all" },
      { action: "actor.createAgent", scope: "all" },
      { action: "apiKey.create", scope: "all" },
      { action: "apiKey.revoke", scope: "all" },
    ],
  },
  {
    key: "admin",
    label: "Admin",
    permissions: [
      {
        object: "*",
        can: ["view", "create", "update", "archive"],
        scope: "all",
      },
      { action: "*", scope: "all" },
    ],
  },
  {
    key: "website",
    label: "Website",
    permissions: [{ object: "organisation", can: ["create"], scope: "all" }],
  },
];

/** The action_log row a call wrote, if it was an action. */
const actionIdOf = (result: object) =>
  ("actionId" in result ? (result.actionId as string | null) : null) ?? "";

const registry = createRegistry([
  ...identityActions,
  ...generateDefinitions(organisation),
]);

describe("API keys, agents and integrations", () => {
  let crm: CrmDatabase;
  let pipeline: Pipeline;
  let auth: Auth;
  let sarah: Caller & { userId: string };
  let admin: Caller;

  const call = (name: string, input: unknown, caller: Caller | null) => {
    const definition = registry.get(name);
    if (!(definition && caller)) {
      throw new Error(`No ${name}, or no caller`);
    }
    return definition.kind === "action"
      ? pipeline.run(definition, input, caller)
      : pipeline.query(definition, input, caller);
  };

  /** Runs a call that must succeed; returns its output. */
  const must = async (name: string, input: unknown, caller: Caller | null) => {
    const result = await call(name, input, caller);
    if (!result.ok) {
      throw new Error(`${name}: ${JSON.stringify(result.error)}`);
    }
    return result.output as Record<string, string>;
  };

  const bearer = (key: string | undefined) =>
    auth.callerFrom(new Headers({ authorization: `Bearer ${key}` }));

  beforeAll(async () => {
    crm = await createCrmDatabase();
    const config = { sha: null, roles };
    pipeline = createPipeline({
      db: crm.db,
      config,
      clock: { now: () => new Date() },
      permissions: rolePermissions({ db: crm.db, config }),
    });
    auth = createAuth({
      db: crm.db,
      secret: "a-test-secret-that-is-at-least-32-characters",
      baseURL: "http://localhost:3000",
    });
    const staff = await createStaffActor(crm.db, "Sarah");
    const boss = await createStaffActor(crm.db, "Boss");
    await crm.db.insert(actorRoles).values([
      { actorId: staff.id, roleKey: "sales" },
      { actorId: boss.id, roleKey: "admin" },
    ]);
    sarah = { actorId: staff.id, userId: staff.userId ?? "" };
    admin = { actorId: boss.id };
  });

  afterAll(async () => {
    await crm?.close();
  });

  it("an agent key acts as the agent, for its user, and never more", async () => {
    const { actorId } = await must(
      "actor.createAgent",
      { name: "Claude" },
      sarah
    );
    const { key } = await must(
      "apiKey.create",
      { actorId, label: "laptop" },
      sarah
    );
    const agent = await bearer(key);
    const created = await call(
      "organisation.create",
      { name: "By agent" },
      agent
    );
    const archived = await call(
      "organisation.archive",
      {
        id: created.ok
          ? (created.output as { record: { id: string } }).record.id
          : "",
      },
      agent
    );
    const log = await crm.db.query.actionLog.findFirst({
      where: (t, { eq }) => eq(t.id, actionIdOf(created)),
    });
    expect(agent).toStrictEqual({ actorId, originUserId: sarah.userId });
    expect(log).toMatchObject({
      actorId,
      originUserId: sarah.userId,
      status: "succeeded",
    });
    // Sarah can't archive, so neither can her agent.
    expect(archived).toMatchObject({
      ok: false,
      error: { permission: "organisation.archive" },
    });
  });

  it("stores only the key's hash, and never logs the key", async () => {
    const { actorId } = await must(
      "actor.createAgent",
      { name: "Logged" },
      sarah
    );
    const result = await call("apiKey.create", { actorId, label: "x" }, sarah);
    const log = await crm.db.query.actionLog.findFirst({
      where: (t, { eq }) => eq(t.id, actionIdOf(result)),
    });
    const stored = JSON.stringify(await crm.db.query.apiKeys.findMany({}));
    const key = result.ok ? (result.output as { key: string }).key : "";
    expect(key).toMatch(/^fx_/u);
    expect(log?.result).toMatchObject({ key: "[redacted]" });
    expect(stored).not.toContain(key);
  });

  it("refuses a revoked key", async () => {
    const { actorId } = await must(
      "actor.createAgent",
      { name: "Temp" },
      sarah
    );
    const { id, key } = await must(
      "apiKey.create",
      { actorId, label: "t" },
      sarah
    );
    await expect(bearer(key)).resolves.toBeTruthy();
    await must("apiKey.revoke", { id }, sarah);
    await expect(bearer(key)).resolves.toBeNull();
    await expect(bearer("fx_not-a-key")).resolves.toBeNull();
  });

  it("an integration can do only what its roles allow", async () => {
    const { actorId } = await must(
      "actor.createIntegration",
      { name: "Website", roles: ["website"] },
      admin
    );
    const { key } = await must(
      "apiKey.create",
      { actorId, label: "prod" },
      admin
    );
    const site = await bearer(key);
    const created = await call(
      "organisation.create",
      { name: "From the site" },
      site
    );
    const listed = await call("organisation.list", {}, site);
    expect(site).toStrictEqual({ actorId, originUserId: null });
    expect(created.ok).toBeTruthy();
    expect(listed).toMatchObject({
      ok: false,
      error: { permission: "organisation.view" },
    });
  });

  it("only an agent's own user can make its keys", async () => {
    const { actorId } = await must(
      "actor.createAgent",
      { name: "Mine" },
      sarah
    );
    const result = await call("apiKey.create", { actorId, label: "x" }, admin);
    expect(result).toMatchObject({ ok: false, error: { code: "permission" } });
  });
});
