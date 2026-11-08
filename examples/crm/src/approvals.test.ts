// Approval rules (P2.09): the CRM's rule on organisation.archive makes a
// sales user's archive wait until an admin approves, and approving runs it
// exactly once, with both people in action_log.
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
  const query = (name: string, input: unknown) =>
    server.pipeline.query(
      crm.registry.get(name) as AnyQueryDefinition,
      input,
      admin
    );

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
      record: { output: { record: { archivedAt: expect.any(String) } } },
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
});
