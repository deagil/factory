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
  auditLogGet,
  auditLogList,
  eventLogGet,
  eventLogList,
  runGet,
  runList,
} from "./logs.ts";
import { rolePermissions } from "./permissions.ts";
import type { Role } from "./permissions.ts";
import { createPipeline } from "./pipeline.ts";
import type { Pipeline } from "./pipeline.ts";

const roles: Role[] = [
  {
    key: "admin",
    label: "Admin",
    objects: {
      "*": {
        endpoints: ["list", "get", "create", "update", "history"],
        rows: "all",
      },
    },
    workflows: "*",
  },
  {
    key: "sales",
    label: "Sales",
    objects: {
      organisation: {
        endpoints: ["list", "get", "create", "history"],
        rows: "all",
      },
    },
  },
];

const [create, update] = generateDefinitions(organisation).filter(
  (definition): definition is AnyActionDefinition => definition.kind !== "query"
) as [AnyActionDefinition, AnyActionDefinition];

interface Entry {
  id: string;
  endpoint: string;
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
    renameId = renamed.ok ? (renamed.runId ?? "") : "";
    await createOrganisation("Globex", sam);
    await createOrganisation("Initech", samsAgent);
  });

  afterAll(async () => {
    await crm?.close();
  });

  it("lists runs newest first, filtered and paged", async () => {
    const { output } = await query<{ entries: Entry[] }>(
      runList,
      { endpointPrefix: "organisation_" },
      admin
    );
    expect(output?.entries.map((entry) => entry.endpoint)).toStrictEqual([
      "organisation_create",
      "organisation_create",
      "organisation_update",
      "organisation_create",
    ]);
    const first = await query<{ entries: Entry[]; nextCursor: string }>(
      runList,
      { endpoint: "organisation_create", limit: 2 },
      admin
    );
    const second = await query<{ entries: Entry[]; nextCursor: null }>(
      runList,
      {
        endpoint: "organisation_create",
        limit: 2,
        cursor: first.output?.nextCursor,
      },
      admin
    );
    expect(second.output?.entries).toHaveLength(1);
    expect(second.output?.nextCursor).toBeNull();
  });

  it("shows anyone without the permission only their own runs", async () => {
    const { output } = await query<{ entries: Entry[] }>(runList, {}, sam);
    expect(
      output?.entries.map((entry) => [entry.actor.name, entry.origin?.name])
    ).toStrictEqual([
      ["Claude", "Sam"],
      ["Sam", "Sam"],
    ]);
  });

  it("gets one run with its step, changes and events, and refuses others'", async () => {
    const { output } = await query<{
      run: {
        steps: { stepId: string; output: unknown }[];
        changes: { after: object; stepId: string }[];
        events: { type: string; stepId: string }[];
      };
    }>(runGet, { id: renameId }, admin);
    const [step] = output?.run.steps ?? [];
    expect({
      steps: output?.run.steps.length,
      stepId: step?.stepId,
      changedIn: output?.run.changes[0]?.stepId,
    }).toStrictEqual({
      steps: 1,
      stepId: "organisation_update",
      changedIn: (step as { id?: string } | undefined)?.id,
    });
    expect(output?.run.changes.map((change) => change.after)).toStrictEqual([
      { name: "Acme Ltd" },
    ]);
    expect(output?.run.events.map((event) => event.type)).toStrictEqual([
      "organisation_updated",
    ]);
    const refused = await query(runGet, { id: renameId }, sam);
    expect(refused.code).toBe("permission");
  });

  it("lists changes to one field, and needs its permission", async () => {
    const { output } = await query<{
      entries: { recordId: string; action: string }[];
    }>(auditLogList, { field: "name", recordId: acmeId }, admin);
    expect(output?.entries.map((entry) => entry.action)).toStrictEqual([
      "organisation_update",
      "organisation_create",
    ]);
    const refused = await query(auditLogList, {}, sam);
    expect(refused.code).toBe("permission");
  });

  it("lists events by type prefix", async () => {
    const { output } = await query<{ entries: { type: string }[] }>(
      eventLogList,
      { typePrefix: "organisation_upd" },
      admin
    );
    expect(output?.entries.map((entry) => entry.type)).toStrictEqual([
      "organisation_updated",
    ]);
  });

  it("gets one change and one event, and needs their permissions", async () => {
    const listed = await query<{
      entries: { id: string; after: object; recordId: string }[];
    }>(auditLogList, { field: "name", recordId: acmeId }, admin);
    const changeId = listed.output?.entries[0]?.id ?? "";
    const got = await query<{
      change: { after: object; recordId: string };
    }>(auditLogGet, { id: changeId }, admin);
    expect(got.output?.change).toMatchObject({
      recordId: acmeId,
      after: { name: "Acme Ltd" },
    });
    const missing = await query(
      auditLogGet,
      { id: "00000000-0000-4000-8000-000000000000" },
      admin
    );
    expect(missing.code).toBe("not_found");
    const refused = await query(auditLogGet, { id: changeId }, sam);
    expect(refused.code).toBe("permission");

    const events = await query<{ entries: { id: string; type: string }[] }>(
      eventLogList,
      { typePrefix: "organisation_upd" },
      admin
    );
    const eventId = events.output?.entries[0]?.id ?? "";
    const event = await query<{ event: { type: string } }>(
      eventLogGet,
      { id: eventId },
      admin
    );
    expect(event.output?.event.type).toBe("organisation_updated");
    const refusedEvent = await query(eventLogGet, { id: eventId }, sam);
    expect(refusedEvent.code).toBe("permission");
  });
});
