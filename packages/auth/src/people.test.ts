import {
  createPipeline,
  createRegistry,
  rolePermissions,
} from "@workspace/actions";
import type { Caller, Pipeline, Role } from "@workspace/actions";
import { actorRoles } from "@workspace/db";
import {
  createCrmDatabase,
  createStaffActor,
} from "@workspace/objects/testing";
import type { CrmDatabase } from "@workspace/objects/testing";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { identityActions } from "./actions.ts";
import { createAuth } from "./auth.ts";
import type { Auth } from "./auth.ts";

const roles: Role[] = [
  {
    key: "admin",
    label: "Admin",
    permissions: [{ action: "*", scope: "all" }],
  },
  {
    key: "sales",
    label: "Sales",
    permissions: [
      { action: "actor.createAgent", scope: "all" },
      { action: "apiKey.create", scope: "all" },
    ],
  },
  { key: "support", label: "Support", permissions: [] },
];

const registry = createRegistry([...identityActions]);

describe("inviting people, roles and disabling (P1b.05)", () => {
  let crm: CrmDatabase;
  let pipeline: Pipeline;
  let auth: Auth;
  let admin: Caller & { userId: string };
  const codes = new Map<string, string>();

  const call = (name: string, input: unknown, caller: Caller | null) => {
    const definition = registry.get(name);
    if (!(definition && caller)) {
      throw new Error(`No ${name}, or no caller`);
    }
    return pipeline.run(definition as never, input, caller);
  };

  const must = async (name: string, input: unknown, caller: Caller | null) => {
    const result = await call(name, input, caller);
    if (!result.ok) {
      throw new Error(`${name}: ${JSON.stringify(result.error)}`);
    }
    return result.output as Record<string, string>;
  };

  /** Signs in with an emailed code; returns the caller, or null. */
  const signIn = async (email: string) => {
    codes.delete(email);
    await auth.auth.api.sendVerificationOTP({
      body: { email, type: "sign-in" },
    });
    const code = codes.get(email);
    if (!code) {
      return null;
    }
    try {
      const { headers } = await auth.auth.api.signInEmailOTP({
        body: { email, otp: code },
        returnHeaders: true,
      });
      const bearer = new Headers({
        authorization: `Bearer ${headers.get("set-auth-token")}`,
      });
      return { bearer, caller: await auth.callerFrom(bearer) };
    } catch {
      return null;
    }
  };

  const rolesOf = async (actorId: string) => {
    const rows = await crm.db.query.actorRoles.findMany({
      where: (t, { eq }) => eq(t.actorId, actorId),
    });
    return rows.map((row) => row.roleKey).toSorted();
  };

  const logged = (actionId: unknown) =>
    crm.db.query.actionLog.findFirst({
      where: (t, { eq }) => eq(t.id, String(actionId)),
    });

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
      sendCode: (email, code) => {
        codes.set(email, code);
        return Promise.resolve();
      },
    });
    const boss = await createStaffActor(crm.db, "Admin");
    await crm.db
      .insert(actorRoles)
      .values({ actorId: boss.id, roleKey: "admin" });
    admin = { actorId: boss.id, userId: boss.userId ?? "" };
  });

  afterAll(async () => {
    await crm?.close();
  });

  it("an invited person signs in with a code and has the invited roles", async () => {
    const result = await call(
      "user.invite",
      { name: "Rosa", email: "rosa@example.com", roles: ["sales"] },
      admin
    );
    const invited = result.ok ? (result.output as { actorId: string }) : null;
    const signedIn = await signIn("rosa@example.com");
    expect(signedIn?.caller?.actorId).toBe(invited?.actorId);
    await expect(rolesOf(invited?.actorId ?? "")).resolves.toStrictEqual([
      "sales",
    ]);
    await expect(
      logged(result.ok ? result.actionId : null)
    ).resolves.toMatchObject({ name: "user.invite", status: "succeeded" });
  });

  it("refuses a taken email and unknown roles", async () => {
    const taken = await call(
      "user.invite",
      { name: "Again", email: "ROSA@example.com", roles: [] },
      admin
    );
    const unknown = await call(
      "user.invite",
      { name: "Ned", email: "ned@example.com", roles: ["boss"] },
      admin
    );
    expect(taken).toMatchObject({ ok: false, error: { code: "conflict" } });
    expect(unknown).toMatchObject({ ok: false, error: { code: "validation" } });
  });

  it("sets roles, keeping an agent's among its person's", async () => {
    const { actorId: staffId } = await must(
      "user.invite",
      { name: "Ali", email: "ali@example.com", roles: ["sales"] },
      admin
    );
    const signedIn = await signIn("ali@example.com");
    const ali = signedIn?.caller ?? null;
    const { actorId: agentId } = await must(
      "actor.createAgent",
      { name: "Ali's Claude" },
      ali
    );
    const beyond = await call(
      "actor.setRoles",
      { id: agentId, roles: ["support"] },
      admin
    );
    const narrowed = await must(
      "actor.setRoles",
      { id: agentId, roles: ["sales"] },
      admin
    );
    await must(
      "actor.setRoles",
      { id: staffId, roles: ["sales", "support"] },
      admin
    );
    const own = await call(
      "actor.setRoles",
      { id: admin.actorId, roles: [] },
      admin
    );
    expect(beyond).toMatchObject({ ok: false, error: { code: "validation" } });
    expect(narrowed.roles).toStrictEqual(["sales"]);
    await expect(rolesOf(staffId ?? "")).resolves.toStrictEqual([
      "sales",
      "support",
    ]);
    expect(own).toMatchObject({ ok: false, error: { code: "permission" } });
    // Sales can't set roles at all.
    const bySales = await call(
      "actor.setRoles",
      { id: agentId, roles: [] },
      ali
    );
    expect(bySales).toMatchObject({ ok: false, error: { code: "permission" } });
  });

  describe("disabling a person", () => {
    let staffId = "";
    let session: Awaited<ReturnType<typeof signIn>> = null;
    let keyHeaders = new Headers();
    let actionId: string | null = null;

    beforeAll(async () => {
      ({ actorId: staffId = "" } = await must(
        "user.invite",
        { name: "Kim", email: "kim@example.com", roles: ["sales"] },
        admin
      ));
      session = await signIn("kim@example.com");
      const { actorId: agentId } = await must(
        "actor.createAgent",
        { name: "Kim's agent" },
        session?.caller ?? null
      );
      const { key } = await must(
        "apiKey.create",
        { actorId: agentId, label: "laptop" },
        session?.caller ?? null
      );
      keyHeaders = new Headers({ authorization: `Bearer ${key}` });
      ({ actionId } = await call("actor.disable", { id: staffId }, admin));
    });

    it("stops them signing in or acting, and refuses their agents' keys", async () => {
      await expect(logged(actionId)).resolves.toMatchObject({
        name: "actor.disable",
        status: "succeeded",
      });
      await expect(signIn("kim@example.com")).resolves.toBeNull();
      await expect(
        auth.callerFrom(session?.bearer ?? new Headers())
      ).resolves.toBeNull();
      await expect(auth.callerFrom(keyHeaders)).resolves.toBeNull();
    });

    it("lets them back in once enabled", async () => {
      await must("actor.enable", { id: staffId }, admin);
      const again = await signIn("kim@example.com");
      expect(again?.caller?.actorId).toBe(staffId);
      await expect(auth.callerFrom(keyHeaders)).resolves.toBeTruthy();
    });
  });

  it("refuses a disabled agent's own keys", async () => {
    const { actorId: agentId } = await must(
      "actor.createAgent",
      { name: "Admin's agent" },
      admin
    );
    const { key } = await must(
      "apiKey.create",
      { actorId: agentId, label: "x" },
      admin
    );
    const headers = new Headers({ authorization: `Bearer ${key}` });
    await must("actor.disable", { id: agentId }, admin);
    await expect(auth.callerFrom(headers)).resolves.toBeNull();
  });

  it("won't let you disable yourself, even through your agent", async () => {
    const self = await call("actor.disable", { id: admin.actorId }, admin);
    expect(self).toMatchObject({ ok: false, error: { code: "permission" } });
  });
});
