// Approval rules (P2.09): the CRM's rule on organisation.archive makes a
// sales user's archive wait until an admin approves, and approving runs it
// exactly once, with both people in action_log. approval.check says so
// beforehand, and whoever asked can withdraw it (decision 0044).
import type {
  AnyActionDefinition,
  AnyQueryDefinition,
} from "@workspace/actions";
import { actionLog, auditLog, bootstrapStaff } from "@workspace/db";
import { createServer } from "@workspace/server";
import type { Server } from "@workspace/server";
import { createSystemDatabase } from "@workspace/server/testing";
import type { SystemDatabase } from "@workspace/server/testing";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { crm } from "./system.ts";

describe("approval rules", () => {
  let database: SystemDatabase;
  let server: Server;
  let sales: { actorId: string };
  let admin: { actorId: string };

  const run = (name: string, input: unknown, caller: { actorId: string }) =>
    server.pipeline.run(
      crm.registry.get(name) as AnyActionDefinition,
      input,
      caller
    );
  const query = (name: string, input: unknown, caller = admin) =>
    server.pipeline.query(
      crm.registry.get(name) as AnyQueryDefinition,
      input,
      caller
    );
  const subjects = (result: unknown) =>
    (
      result as { output: { approvals: { subjectId: string }[] } }
    ).output.approvals.map((each) => each.subjectId);

  beforeAll(async () => {
    database = await createSystemDatabase(crm);
    server = await createServer(crm, {
      databaseUrl: database.url,
      authSecret: "a-test-secret-that-is-at-least-32-characters",
      baseURL: "http://localhost:4000",
      log: () => {},
    });
    const [sam, ada] = await Promise.all([
      bootstrapStaff(server.db, {
        name: "Sam Sales",
        email: "sam@example.com",
        roles: ["sales"],
      }),
      bootstrapStaff(server.db, {
        name: "Ada Admin",
        email: "ada@example.com",
        roles: ["admin"],
      }),
    ]);
    sales = { actorId: sam.id };
    admin = { actorId: ada.id };
  });

  afterAll(async () => {
    await server?.close();
    await database?.close();
  });

  it("makes a sales user's archive wait for an admin, then runs it once", async () => {
    const created = await run("organisation.create", { name: "Acme" }, sales);
    const { id } = (created as { output: { record: { id: string } } }).output
      .record;

    const archived = await run("organisation.archive", { id }, sales);
    expect(archived).toMatchObject({
      ok: false,
      error: { code: "approval_required", rule: "archive-organisations" },
    });
    const pendingId = archived.actionId ?? "";
    const listed = await query("approval.list", { status: "pending" });
    const approval = (
      listed as { output: { approvals: { id: string; subjectId: string }[] } }
    ).output.approvals.find((each) => each.subjectId === pendingId);

    // Sam can't approve his own; Ada can, once.
    const bySales = await run("approval.approve", { id: approval?.id }, sales);
    const record = await query("organisation.get", { id });
    const approved = await run("approval.approve", { id: approval?.id }, admin);
    const again = await run("approval.approve", { id: approval?.id }, admin);
    expect({ bySales, record, approved, again }).toMatchObject({
      bySales: { ok: false, error: { code: "permission" } },
      record: { ok: true, output: { record: { archivedAt: null } } },
      approved: {
        ok: true,
        output: { ran: { actionId: pendingId, ok: true } },
      },
      again: { ok: false, error: { code: "conflict" } },
    });

    const rows = await database.db
      .select()
      .from(actionLog)
      .where(eq(actionLog.name, "organisation.archive"));
    const changes = await database.db
      .select({ actionId: auditLog.actionId })
      .from(auditLog)
      .where(eq(auditLog.recordId, id));
    expect({
      archive: rows.map((row) => [row.actorId, row.status]),
      approve: approved.actionId,
      changes: changes.map((change) => change.actionId),
      record: await query("organisation.get", { id }),
    }).toMatchObject({
      archive: [[sales.actorId, "succeeded"]],
      approve: expect.any(String),
      changes: expect.arrayContaining([pendingId]),
      // Archived records are hidden.
      record: { ok: false, error: { code: "not_found" } },
    });
    const [approveRow] = await database.db
      .select()
      .from(actionLog)
      .where(eq(actionLog.id, approved.actionId ?? ""));
    expect(approveRow).toMatchObject({
      name: "approval.approve",
      actorId: admin.actorId,
      status: "succeeded",
    });
  });

  it("lets an admin archive straight away, and a rejection never runs it", async () => {
    const created = await run("organisation.create", { name: "Beta" }, admin);
    const { id } = (created as { output: { record: { id: string } } }).output
      .record;
    const other = await run("organisation.create", { name: "Gamma" }, sales);
    const otherId = (other as { output: { record: { id: string } } }).output
      .record.id;
    const waiting = await run("organisation.archive", { id: otherId }, sales);
    const listed = await query("approval.list", { status: "pending" });
    const approval = (
      listed as { output: { approvals: { id: string; subjectId: string }[] } }
    ).output.approvals.find((each) => each.subjectId === waiting.actionId);
    const rejected = await run(
      "approval.reject",
      { id: approval?.id, comment: "Still a customer" },
      admin
    );
    const [row] = await database.db
      .select({ status: actionLog.status })
      .from(actionLog)
      .where(eq(actionLog.id, waiting.actionId ?? ""));
    expect({
      direct: await run("organisation.archive", { id }, admin),
      rejected,
      row,
      gamma: await query("organisation.get", { id: otherId }),
    }).toMatchObject({
      direct: { ok: true },
      rejected: { ok: true, output: { approval: { status: "rejected" } } },
      row: { status: "rejected" },
      gamma: { output: { record: { archivedAt: null } } },
    });
  });

  it("says beforehand who must approve, lists requests by record, mine and decidable, and lets the requester withdraw", async () => {
    const created = await run("organisation.create", { name: "Delta" }, sales);
    const { id } = (created as { output: { record: { id: string } } }).output
      .record;
    const check = (caller: { actorId: string }) =>
      query(
        "approval.check",
        { action: "organisation.archive", input: { id } },
        caller
      );
    const [forSales, forAdmin] = await Promise.all([
      check(sales),
      check(admin),
    ]);

    const waiting = await run("organisation.archive", { id }, sales);
    const pendingId = waiting.actionId ?? "";
    const [onRecord, salesMine, adminMine, adminDecides, salesDecides] =
      await Promise.all([
        query("approval.list", { recordId: id }),
        query("approval.list", { mine: true, status: "pending" }, sales),
        query("approval.list", { mine: true }),
        query("approval.list", { decidable: true }),
        query("approval.list", { decidable: true }, sales),
      ]);
    const byAdmin = await run(
      "approval.withdraw",
      { subjectId: pendingId },
      admin
    );
    const withdrawn = await run(
      "approval.withdraw",
      { subjectId: pendingId },
      sales
    );
    const [row] = await database.db
      .select({ status: actionLog.status })
      .from(actionLog)
      .where(eq(actionLog.id, pendingId));
    expect({
      forSales,
      forAdmin,
      onRecord: subjects(onRecord),
      salesMine: subjects(salesMine),
      adminMine: subjects(adminMine),
      adminDecides: subjects(adminDecides),
      salesDecides: subjects(salesDecides),
      byAdmin,
      withdrawn,
      row,
      left: subjects(await query("approval.list", { decidable: true })),
      record: await query("organisation.get", { id }),
    }).toMatchObject({
      forSales: {
        ok: true,
        output: {
          signOffs: [
            {
              rule: "archive-organisations",
              label: "Archiving an organisation",
              approverRole: "admin",
              approvals: 1,
            },
          ],
        },
      },
      forAdmin: { ok: true, output: { signOffs: [] } },
      onRecord: [pendingId],
      salesMine: [pendingId],
      adminMine: expect.not.arrayContaining([pendingId]),
      adminDecides: expect.arrayContaining([pendingId]),
      salesDecides: [],
      byAdmin: { ok: false, error: { code: "permission" } },
      withdrawn: { ok: true, output: { withdrawn: 1 } },
      row: { status: "withdrawn" },
      left: expect.not.arrayContaining([pendingId]),
      record: { output: { record: { archivedAt: null } } },
    });
  });
});
