// A test API on a fresh CRM database: an admin, a website integration, and
// Sarah (sales) with an agent. Used by this package's tests only.
import {
  createPipeline,
  createRegistry,
  describeQuery,
  generateDefinitions,
  objectEndpoints,
  rolePermissions,
} from "@workspace/actions";
import type { Caller, Pipeline, Role } from "@workspace/actions";
import { createAuth, identityActions } from "@workspace/auth";
import { actorRoles } from "@workspace/db";
import {
  contact,
  createCrmDatabase,
  createStaffActor,
  organisation,
} from "@workspace/objects/testing";

import { createApi } from "../api.ts";

export const roles: Role[] = [
  {
    key: "admin",
    label: "Admin",
    objects: {
      "*": { endpoints: "*", rows: "all" },
    },
    workflows: "*",
  },
  {
    key: "website",
    label: "Website",
    objects: {
      organisation: {
        endpoints: ["list", "get", "create", "history"],
        rows: "all",
      },
    },
  },
  {
    key: "reader",
    label: "Reader",
    objects: {
      organisation: {
        endpoints: ["list", "get", "history"],
        rows: "all",
      },
    },
  },
  {
    key: "sales",
    label: "Sales",
    objects: {
      "*": {
        endpoints: ["list", "get", "create", "update", "history"],
        rows: "all",
      },
    },
    workflows: ["actor.createAgent", "apiKey.create"],
  },
];

const definitions = [
  ...identityActions,
  ...generateDefinitions(organisation),
  ...generateDefinitions(contact),
];

/** The REST endpoints of the test objects. */
export const endpoints = [organisation, contact].flatMap((object) =>
  objectEndpoints(object)
);

export const registry = createRegistry([
  ...definitions,
  describeQuery({ objects: [organisation, contact], definitions }),
]);

/** Runs an identity action that must succeed; returns its output. */
const must = async (
  pipeline: Pipeline,
  name: string,
  input: unknown,
  caller: Caller
) => {
  const definition = registry.get(name);
  if (!definition || definition.kind === "query") {
    throw new Error(`No action ${name}`);
  }
  const result = await pipeline.run(definition, input, caller);
  if (!result.ok) {
    throw new Error(`${name}: ${JSON.stringify(result.error)}`);
  }
  return result.output as Record<string, string>;
};

export const createTestApi = async () => {
  const crm = await createCrmDatabase();
  const config = { sha: null, roles };
  const pipeline = createPipeline({
    db: crm.db,
    config,
    clock: { now: () => new Date() },
    permissions: rolePermissions({ db: crm.db, config }),
  });
  const auth = createAuth({
    db: crm.db,
    secret: "a-test-secret-that-is-at-least-32-characters",
    baseURL: "http://localhost:3000",
  });
  const boss = await createStaffActor(crm.db, "Boss");
  const sarah = await createStaffActor(crm.db, "Sarah");
  await crm.db.insert(actorRoles).values([
    { actorId: boss.id, roleKey: "admin" },
    { actorId: sarah.id, roleKey: "sales" },
  ]);
  const admin = { actorId: boss.id };
  const sales = { actorId: sarah.id, originUserId: sarah.userId ?? "" };

  const integration = await must(
    pipeline,
    "actor.createIntegration",
    { name: "Website", roles: ["website"] },
    admin
  );
  const website = await must(
    pipeline,
    "apiKey.create",
    { actorId: integration.actorId, label: "site" },
    admin
  );
  const agent = await must(
    pipeline,
    "actor.createAgent",
    { name: "Claude" },
    sales
  );
  const agentKey = await must(
    pipeline,
    "apiKey.create",
    { actorId: agent.actorId, label: "laptop" },
    sales
  );

  const api = createApi({
    registry,
    endpoints,
    pipeline,
    callerFrom: auth.callerFrom,
    authHandler: auth.auth.handler,
  });
  return {
    api,
    crm,
    pipeline,
    admin,
    keys: { website: website.key ?? "", agent: agentKey.key ?? "" },
    actors: {
      agent: agent.actorId ?? "",
      sarahUser: sales.originUserId,
    },
  };
};

export type TestApi = Awaited<ReturnType<typeof createTestApi>>;
