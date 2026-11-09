import { actorRoles } from "@workspace/db";
import {
  contact,
  createCrmDatabase,
  createStaffActor,
  organisation,
} from "@workspace/objects/testing";
import type { CrmDatabase } from "@workspace/objects/testing";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { describeQuery } from "./describe.ts";
import type { SystemDescription } from "./describe.ts";
import { generateDefinitions } from "./generated.ts";
import { rolePermissions } from "./permissions.ts";
import type { Role } from "./permissions.ts";
import { createPipeline } from "./pipeline.ts";
import type { Pipeline } from "./pipeline.ts";

const roles: Role[] = [
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
        endpoints: ["create"],
        rows: "own",
        read: { except: ["website"] },
      },
    },
  },
];

const describeSystem = describeQuery({
  objects: [organisation, contact],
  definitions: [
    ...generateDefinitions(organisation),
    ...generateDefinitions(contact),
  ],
});

describe("system.describe", () => {
  let crm: CrmDatabase;
  let pipeline: Pipeline;
  let people = 0;

  beforeAll(async () => {
    crm = await createCrmDatabase();
    const config = { sha: null, roles };
    pipeline = createPipeline({
      db: crm.db,
      config,
      clock: { now: () => new Date() },
      permissions: rolePermissions({ db: crm.db, config }),
    });
  });

  afterAll(async () => {
    await crm?.close();
  });

  const describeAs = async (role: string | null) => {
    people += 1;
    const actor = await createStaffActor(crm.db, `Person${people}`);
    if (role) {
      await crm.db
        .insert(actorRoles)
        .values({ actorId: actor.id, roleKey: role });
    }
    const result = await pipeline.query(
      describeSystem,
      {},
      { actorId: actor.id }
    );
    if (!result.ok) {
      throw new Error(JSON.stringify(result.error));
    }
    return result.output as SystemDescription;
  };

  it("describes everything to an admin", async () => {
    const described = await describeAs("admin");
    expect(described).toMatchSnapshot();
  });

  it("leaves out what a restricted actor can't use", async () => {
    const described = await describeAs("website");
    expect(
      described.objects.map(({ name, endpoints, rows, fields }) => ({
        name,
        endpoints,
        rows,
        hidden: fields.filter((field) => !field.read).map((field) => field.key),
      }))
    ).toStrictEqual([
      {
        name: "organisation",
        rows: "own",
        hidden: ["website"],
        endpoints: [
          {
            method: "POST",
            path: "/organisations",
            name: "organisation_create",
          },
        ],
      },
    ]);
    expect(described.actions.map((action) => action.name)).toStrictEqual([
      "organisation_create",
    ]);
    expect(described.queries.map((query) => query.name)).toStrictEqual([
      "system.describe",
    ]);
    expect(described.events.map((event) => event.type)).toStrictEqual([
      "organisation_created",
    ]);
  });

  it("is open to an actor with no roles, and shows them only itself", async () => {
    const described = await describeAs(null);
    expect(described).toStrictEqual({
      objects: [],
      actions: [],
      queries: [expect.objectContaining({ name: "system.describe" })],
      events: [],
      workflows: [],
    });
  });

  it("marks what the caller may read and write, and ref targets", async () => {
    const described = await describeAs("admin");
    const fields = described.objects.find(
      (object) => object.name === "contact"
    )?.fields;
    expect(fields?.find((field) => field.key === "organisation")).toMatchObject(
      {
        type: "ref",
        target: "organisation",
        read: true,
        write: true,
      }
    );
  });
});
