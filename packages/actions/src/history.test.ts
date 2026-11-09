import { actorRoles } from "@workspace/db";
import {
  contact,
  createCrmDatabase,
  createStaffActor,
  organisation,
} from "@workspace/objects/testing";
import type { CrmDatabase } from "@workspace/objects/testing";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import type { AnyActionDefinition } from "./define-action.ts";
import { generateDefinitions } from "./generated.ts";
import { historyQuery } from "./history.ts";
import type { HistoryEntry } from "./history.ts";
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
  },
];

const [create, update] = generateDefinitions(organisation).filter(
  (definition): definition is AnyActionDefinition =>
    definition.kind === "action"
) as [AnyActionDefinition, AnyActionDefinition];
const history = historyQuery([organisation, contact]);

describe("record.history", () => {
  let crm: CrmDatabase;
  let pipeline: Pipeline;
  let admin: { actorId: string };
  let stranger: { actorId: string };

  beforeAll(async () => {
    crm = await createCrmDatabase();
    const config = { sha: null, roles };
    pipeline = createPipeline({
      db: crm.db,
      config,
      clock: { now: () => new Date() },
      permissions: rolePermissions({ db: crm.db, config }),
    });
    const sarah = await createStaffActor(crm.db, "Sarah");
    await crm.db
      .insert(actorRoles)
      .values({ actorId: sarah.id, roleKey: "admin" });
    admin = { actorId: sarah.id };
    const sam = await createStaffActor(crm.db, "Sam");
    stranger = { actorId: sam.id };
  });

  afterAll(async () => {
    await crm?.close();
  });

  it("lists each change, newest first, with its action and actor", async () => {
    const created = await pipeline.run(create, { name: "Acme" }, admin);
    const id =
      (created.ok &&
        (created.output as { record: { id: string } }).record.id) ||
      "";
    await pipeline.run(update, { id, name: "Acme Ltd" }, admin);

    const result = await pipeline.query(
      history,
      { object: "organisation", id },
      admin
    );
    const entries = result.ok
      ? (result.output as { entries: HistoryEntry[] }).entries
      : [];
    expect(
      entries.map((entry) => [entry.action, entry.before, entry.after])
    ).toStrictEqual([
      ["organisation_update", { name: "Acme" }, { name: "Acme Ltd" }],
      ["organisation_create", {}, expect.objectContaining({ name: "Acme" })],
    ]);
    expect(entries[0]?.actor).toMatchObject({ name: "Sarah", kind: "staff" });
    expect(entries[0]?.onBehalfOf).toBeNull();
  });

  it("refuses a caller who can't view the object", async () => {
    const result = await pipeline.query(
      history,
      { object: "organisation", id: "019a5b3c-7d2e-7f00-8a1b-2c3d4e5f6a7b" },
      stranger
    );
    expect(result.ok ? null : result.error.code).toBe("permission");
  });
});
