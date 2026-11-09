import { auditLog, runs, runSteps, withTransaction } from "@workspace/db";
import type { Tx } from "@workspace/db";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createdRecord, createRepository } from "./repository.ts";
import type { Repository } from "./repository.ts";
import {
  createCrmDatabase,
  createStaffActor,
} from "./test-fixtures/crm-database.ts";
import type { CrmDatabase } from "./test-fixtures/crm-database.ts";
import { contact, organisation } from "./test-fixtures/crm-schema.ts";

const clock = new Date("2026-11-06T09:00:00Z");

describe("repositories", () => {
  let crm: CrmDatabase;
  let actorId: string;

  /**
   * Runs `work` the way an action will: in a transaction, after writing its
   * run and step rows, with a repository bound to them.
   */
  const inAction = <T>(work: (repo: Repository, tx: Tx) => Promise<T>) =>
    withTransaction(crm.db, async (tx) => {
      const [run] = await tx
        .insert(runs)
        .values({
          endpoint: "test.write",
          actorId,
          input: {},
          status: "succeeded",
        })
        .returning();
      const [step] = await tx
        .insert(runSteps)
        .values({
          runId: run?.id ?? "",
          stepId: "test.write",
          kind: "action",
          name: "test.write",
        })
        .returning();
      const repo = createRepository({
        executor: tx,
        runId: run?.id ?? "",
        stepId: step?.id ?? "",
        actorId,
        now: () => clock,
      });
      return work(repo, tx);
    });

  const auditRows = (recordId: string) =>
    crm.db
      .select()
      .from(auditLog)
      .where(eq(auditLog.recordId, recordId))
      .orderBy(auditLog.id);

  const newOrganisation = (values: Record<string, unknown> = {}) =>
    inAction(async (repo) =>
      createdRecord(
        await repo.create(organisation, { name: "Acme", ...values })
      )
    );

  beforeAll(async () => {
    crm = await createCrmDatabase();
    const actor = await createStaffActor(crm.db, "Sarah");
    actorId = actor.id;
  });

  afterAll(async () => {
    await crm?.close();
  });

  it("refuses to run outside a transaction", () => {
    expect(() =>
      createRepository({
        executor: crm.db,
        runId: "x",
        stepId: "x",
        actorId,
        now: () => clock,
      })
    ).toThrow(/inside an action's transaction/u);
  });

  describe("create", () => {
    it("writes the record with who and when", async () => {
      const org = await newOrganisation({ employees: 12 });
      expect(org).toMatchObject({
        name: "Acme",
        employees: 12,
        website: null,
        createdBy: actorId,
        updatedBy: actorId,
        version: 1,
      });
      expect(org.createdAt).toBe(clock.toISOString());
    });

    it("writes one audit row with the values set", async () => {
      const org = await newOrganisation({
        employees: 12,
        customFields: { tier: "gold" },
      });
      const rows = await auditRows(org.id);
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({
        object: "organisation",
        actorId,
        before: {},
        after: {
          name: "Acme",
          employees: 12,
          "customFields.tier": "gold",
        },
      });
    });

    it("points the audit row at the run", async () => {
      const { org, runId } = await inAction(async (repo, tx) => {
        const created = createdRecord(
          await repo.create(organisation, { name: "Acme" })
        );
        const [row] = await tx
          .select({ runId: auditLog.runId })
          .from(auditLog)
          .where(eq(auditLog.recordId, created.id));
        return { org: created, runId: row?.runId };
      });
      const [run] = await crm.db
        .select()
        .from(runs)
        .where(eq(runs.id, runId ?? ""));
      expect(run?.endpoint).toBe("test.write");
      expect(org.id).toBeTruthy();
    });

    it("checks values with the object's rules", async () => {
      await expect(newOrganisation({ employees: -1 })).rejects.toThrow(
        /employees/u
      );
      await expect(newOrganisation({ name: undefined })).rejects.toThrow(
        /name/u
      );
    });

    it("refuses custom fields on an object without them", async () => {
      const org = await newOrganisation();
      await expect(
        inAction(async (repo) =>
          createdRecord(
            await repo.create(contact, {
              firstName: "Ada",
              organisation: org.id,
              active: true,
              customFields: { x: 1 },
            })
          )
        )
      ).rejects.toThrow(/no custom fields/u);
    });
  });

  describe("update", () => {
    it("writes one audit row for two changed fields", async () => {
      const org = await newOrganisation({ employees: 12 });
      const result = await inAction((repo) =>
        repo.update(organisation, org.id, {
          name: "Acme Ltd",
          employees: 15,
          website: null,
        })
      );
      expect(result).toMatchObject({
        status: "updated",
        before: { name: "Acme", employees: 12 },
        after: { name: "Acme Ltd", employees: 15 },
      });
      const rows = await auditRows(org.id);
      expect(rows).toHaveLength(2);
      expect(rows[1]).toMatchObject({
        before: { name: "Acme", employees: 12 },
        after: { name: "Acme Ltd", employees: 15 },
      });
    });

    it("bumps the version and records who changed it", async () => {
      const org = await newOrganisation();
      const result = await inAction((repo) =>
        repo.update(organisation, org.id, { employees: 3 })
      );
      expect(result.status).toBe("updated");
      expect(result).toMatchObject({
        record: { employees: 3, version: 2, updatedBy: actorId },
      });
    });

    it("writes nothing when nothing changes", async () => {
      const org = await newOrganisation({ employees: 12 });
      const result = await inAction((repo) =>
        repo.update(organisation, org.id, { name: "Acme", employees: 12 })
      );
      expect(result).toMatchObject({
        status: "unchanged",
        record: { version: 1 },
      });
      await expect(auditRows(org.id)).resolves.toHaveLength(1);
    });

    it("compares structured values by value", async () => {
      const org = await newOrganisation();
      const values = {
        firstName: "Ada",
        organisation: org.id,
        active: true,
        birthday: "1815-12-10",
        lifetimeValue: { amount: 1250, currency: "GBP" },
      };
      const ada = await inAction(async (repo) =>
        createdRecord(await repo.create(contact, values))
      );
      const result = await inAction((repo) =>
        repo.update(contact, ada.id, {
          birthday: "1815-12-10",
          lifetimeValue: { amount: 1250, currency: "GBP" },
        })
      );
      expect(result.status).toBe("unchanged");
    });

    it("records custom fields key by key", async () => {
      const org = await newOrganisation({
        customFields: { tier: "gold", region: "north" },
      });
      const result = await inAction((repo) =>
        repo.update(organisation, org.id, {
          customFields: { tier: "silver", region: "north", seats: 4 },
        })
      );
      expect(result).toMatchObject({
        status: "updated",
        before: { "customFields.tier": "gold", "customFields.seats": null },
        after: { "customFields.tier": "silver", "customFields.seats": 4 },
        record: { customFields: { tier: "silver", region: "north", seats: 4 } },
      });
      expect(result.status === "updated" && result.before).not.toHaveProperty(
        "customFields.region"
      );
    });

    it("returns not_found for a missing record", async () => {
      const result = await inAction((repo) =>
        repo.update(organisation, "00000000-0000-7000-8000-000000000000", {
          name: "X",
        })
      );
      expect(result).toStrictEqual({ status: "not_found" });
    });

    it("returns conflict when the version moved on", async () => {
      const org = await newOrganisation();
      const result = await inAction((repo) =>
        repo.update(
          organisation,
          org.id,
          { name: "Acme Ltd" },
          { expectedVersion: 7 }
        )
      );
      expect(result.status).toBe("conflict");
      await expect(auditRows(org.id)).resolves.toHaveLength(1);
    });

    it("waits for a concurrent update when asked to lock", async () => {
      const org = await newOrganisation({ employees: 0 });
      const setTo = (employees: number) =>
        inAction((repo) =>
          repo.update(organisation, org.id, { employees }, { lock: true })
        );
      const results = await Promise.all([setTo(1), setTo(2), setTo(3)]);
      expect(results.map((r) => r.status)).toStrictEqual([
        "updated",
        "updated",
        "updated",
      ]);
      await expect(auditRows(org.id)).resolves.toHaveLength(4);
    });

    it("refuses to change an archived record", async () => {
      const org = await newOrganisation();
      await inAction((repo) => repo.archive(organisation, org.id));
      const result = await inAction((repo) =>
        repo.update(organisation, org.id, { name: "Acme Ltd" })
      );
      expect(result.status).toBe("archived");
    });

    it("rolls back with the action", async () => {
      const org = await newOrganisation();
      await expect(
        inAction(async (repo) => {
          await repo.update(organisation, org.id, { name: "Acme Ltd" });
          throw new Error("the action failed");
        })
      ).rejects.toThrow("the action failed");
      const result = await inAction((repo) =>
        repo.update(organisation, org.id, { name: "Acme" })
      );
      expect(result.status).toBe("unchanged");
      await expect(auditRows(org.id)).resolves.toHaveLength(1);
    });
  });

  describe("archive", () => {
    it("sets archivedAt and records it in the audit log", async () => {
      const org = await newOrganisation();
      const result = await inAction((repo) =>
        repo.archive(organisation, org.id)
      );
      const rows = await auditRows(org.id);
      expect(result).toMatchObject({
        status: "archived",
        record: { archivedAt: clock.toISOString(), version: 2 },
      });
      expect(rows.at(-1)).toMatchObject({
        before: { archivedAt: null },
        after: { archivedAt: clock.toISOString() },
      });
    });

    it("restores an archived record, and records that too", async () => {
      const org = await newOrganisation();
      await inAction((repo) => repo.archive(organisation, org.id));
      const restored = await inAction((repo) =>
        repo.restore(organisation, org.id)
      );
      const again = await inAction((repo) =>
        repo.restore(organisation, org.id)
      );
      const rows = await auditRows(org.id);
      expect(restored).toMatchObject({
        status: "restored",
        record: { archivedAt: null, version: 3 },
      });
      expect(again.status).toBe("unchanged");
      expect(rows.at(-1)).toMatchObject({
        before: { archivedAt: clock.toISOString() },
        after: { archivedAt: null },
      });
    });

    it("leaves an archived record alone", async () => {
      const org = await newOrganisation();
      await inAction((repo) => repo.archive(organisation, org.id));
      const again = await inAction((repo) =>
        repo.archive(organisation, org.id)
      );
      expect(again.status).toBe("unchanged");
    });
  });
});
