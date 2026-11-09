// Approval limits (decision 0043): tiers on a deal's value, read from the
// record; a manager and a senior for large deals; two different managers for
// a junior's archive of an organisation; nobody approving their own request
// or their agent's; and a rule that newly applies while an action waits.
import { cpSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import type {
  AnyActionDefinition,
  AnyQueryDefinition,
} from "@workspace/actions";
import { bootstrapStaff } from "@workspace/db";
import { createServer, defineSystem } from "@workspace/server";
import type { Server } from "@workspace/server";
import { createSystemDatabase } from "@workspace/server/testing";
import type { SystemDatabase } from "@workspace/server/testing";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { crm } from "./system.ts";

const pence = (pounds: number) => pounds * 100;
const tier = (key: string, approver: string, from: number, to?: number) =>
  [
    `key: ${key}`,
    `label: ${key}`,
    "action: deal_archive",
    "record: { object: deal, id: input.id }",
    "when:",
    "  - { field: record.value.currency, operator: eq, value: GBP }",
    `  - { field: record.value.amount, operator: gt, value: ${pence(from)} }`,
    ...(to === undefined
      ? []
      : [
          `  - { field: record.value.amount, operator: lte, value: ${pence(to)} }`,
        ]),
    `approver: ${approver}`,
    ...(approver === "manager" ? ["exempt: [manager, senior]"] : []),
    "",
  ].join("\n");

const role = (key: string, lines: string[]) =>
  [`key: ${key}`, `label: ${key}`, "permissions:", ...lines, ""].join("\n");
const can = (object: string, verbs: string) =>
  `  - { object: ${object}, can: [${verbs}], scope: all }`;

const idOf = (result: { ok: boolean; output?: unknown }) =>
  (result.output as { record: { id: string } }).record.id;

describe("approval limits", () => {
  // The CRM's config with these roles and rules in place of its own rule on
  // archiving organisations.
  const config = path.join(
    mkdtempSync(path.join(tmpdir(), "crm-limits-")),
    "config"
  );
  cpSync(path.resolve(import.meta.dirname, "../config"), config, {
    recursive: true,
  });
  rmSync(path.join(config, "approvals", "archive_organisations.yaml"));
  const files: Record<string, string> = {
    "roles/junior.yaml": role("junior", [
      can("deal", "view, archive"),
      can("organisation", "view, archive"),
    ]),
    "roles/manager.yaml": role("manager", [
      can("deal", "view, update, archive"),
      can("organisation", "view, archive"),
      "  - { action: actor.createAgent, scope: all }",
    ]),
    "roles/senior.yaml": role("senior", [
      can("deal", "view, archive"),
      can("organisation", "view, archive"),
    ]),
    "approvals/deal_medium.yaml": tier("deal_medium", "manager", 1000, 10_000),
    "approvals/deal_large_manager.yaml": tier(
      "deal_large_manager",
      "manager",
      10_000
    ),
    "approvals/deal_large_senior.yaml": tier(
      "deal_large_senior",
      "senior",
      10_000
    ),
    "approvals/organisations_by_juniors.yaml": [
      "key: organisations_by_juniors",
      "label: Juniors archiving organisations",
      "action: organisation_archive",
      "requester: [junior]",
      "approvals: 2",
      "approver: manager",
      "",
    ].join("\n"),
  };
  for (const [file, content] of Object.entries(files)) {
    writeFileSync(path.join(config, file), content);
  }
  const system = defineSystem({
    name: crm.name,
    objects: crm.objects,
    actions: crm.registry
      .list()
      .filter((definition) =>
        [
          "contact.moveToOrganisation",
          "deal_create",
          "deal.moveStage",
        ].includes(definition.name)
      ),
    migrations: crm.migrations,
    config,
  });

  let database: SystemDatabase;
  let server: Server;
  const people: Record<string, { actorId: string }> = {};

  const run = (name: string, input: unknown, by: string) =>
    server.pipeline.run(
      system.registry.get(name) as AnyActionDefinition,
      input,
      people[by] ?? { actorId: by }
    );
  /** The pending approvals on `subjectId`, as [id, rule] pairs. */
  const pending = async (subjectId: string | null) => {
    const listed = await server.pipeline.query(
      system.registry.get("approval.list") as AnyQueryDefinition,
      { status: "pending" },
      people.ada as { actorId: string }
    );
    return (
      listed as {
        output: {
          approvals: { id: string; subjectId: string; rule: string }[];
        };
      }
    ).output.approvals
      .filter((each) => each.subjectId === subjectId)
      .map((each) => [each.id, each.rule] as const)
      .toSorted((a, b) => a[1].localeCompare(b[1]));
  };
  const deal = async (pounds: number) => {
    const org = await run("organisation_create", { name: "Buyer" }, "ada");
    return idOf(
      await run(
        "deal_create",
        {
          name: `£${pounds}`,
          organisation: idOf(org),
          value: { amount: pence(pounds), currency: "GBP" },
          stage: "lead",
        },
        "ada"
      )
    );
  };

  beforeAll(async () => {
    database = await createSystemDatabase(system);
    server = await createServer(system, {
      databaseUrl: database.url,
      authSecret: "a-test-secret-that-is-at-least-32-characters",
      baseURL: "http://localhost:4000",
      log: () => {},
    });
    const staff: [string, string[]][] = [
      ["ada", ["admin"]],
      ["jo", ["junior"]],
      ["mia", ["manager"]],
      ["max", ["manager", "senior"]],
      ["sue", ["senior"]],
    ];
    for (const [name, roles] of staff) {
      // oxlint-disable-next-line eslint/no-await-in-loop -- a few people, in order
      const actor = await bootstrapStaff(server.db, {
        name,
        email: `${name}@example.com`,
        roles,
      });
      people[name] = { actorId: actor.id };
    }
  });

  afterAll(async () => {
    await server?.close();
    await database?.close();
  });

  it("asks nothing for a small deal and one manager for a medium one", async () => {
    const small = await run("deal_archive", { id: await deal(500) }, "jo");
    const medium = await run("deal_archive", { id: await deal(5000) }, "jo");
    const [[approval] = []] = await pending(medium.runId);
    const bySenior = await run("approval.approve", { id: approval }, "sue");
    const byManager = await run("approval.approve", { id: approval }, "mia");
    expect({ small, medium, bySenior, byManager }).toMatchObject({
      small: { ok: true },
      medium: { ok: false, error: { rule: "deal_medium" } },
      bySenior: { ok: false, error: { code: "permission" } },
      byManager: { ok: true, output: { ran: { ok: true } } },
    });
  });

  it("needs a manager and a different senior for a large deal", async () => {
    const waiting = await run("deal_archive", { id: await deal(20_000) }, "jo");
    const [[forManager] = [], [forSenior] = []] = await pending(waiting.runId);
    // Max holds both roles, but approves once.
    const first = await run("approval.approve", { id: forManager }, "max");
    const again = await run("approval.approve", { id: forSenior }, "max");
    const last = await run("approval.approve", { id: forSenior }, "sue");
    // A manager archiving a large deal needs only the senior.
    const byManager = await run(
      "deal_archive",
      { id: await deal(20_000) },
      "mia"
    );
    expect({
      first,
      again,
      last,
      byManager: [byManager.ok, await pending(byManager.runId)],
    }).toMatchObject({
      first: { ok: true, output: { ran: null } },
      again: { ok: false, error: { code: "permission" } },
      last: { ok: true, output: { ran: { ok: true } } },
      byManager: [false, [[expect.any(String), "deal_large_senior"]]],
    });
  });

  it("needs two different managers when a junior archives an organisation", async () => {
    const org = idOf(await run("organisation_create", { name: "Old" }, "ada"));
    const waiting = await run("organisation_archive", { id: org }, "jo");
    const [[one] = [], [two] = []] = await pending(waiting.runId);
    const first = await run("approval.approve", { id: one }, "mia");
    const twice = await run("approval.approve", { id: two }, "mia");
    const second = await run("approval.approve", { id: two }, "max");
    expect({ first, twice, second }).toMatchObject({
      first: { ok: true, output: { ran: null } },
      twice: { ok: false, error: { code: "permission" } },
      second: { ok: true, output: { ran: { ok: true } } },
    });
  });

  it("asks for a person when a manager's agent acts, and not that manager", async () => {
    const agent = await run(
      "actor.createAgent",
      { name: "Mia's agent" },
      "mia"
    );
    const agentId = (agent as { output: { actorId: string } }).output.actorId;
    const waiting = await run(
      "deal_archive",
      { id: await deal(5000) },
      agentId
    );
    const [[approval] = []] = await pending(waiting.runId);
    expect({
      waiting,
      byMia: await run("approval.approve", { id: approval }, "mia"),
      byMax: await run("approval.approve", { id: approval }, "max"),
    }).toMatchObject({
      waiting: { ok: false, error: { rule: "deal_medium" } },
      byMia: { ok: false, error: { code: "permission" } },
      byMax: { ok: true, output: { ran: { ok: true } } },
    });
  });

  it("doesn't run an action that came to need more approval while it waited", async () => {
    const id = await deal(5000);
    const waiting = await run("deal_archive", { id }, "jo");
    const [[approval] = []] = await pending(waiting.runId);
    await run(
      "deal_update",
      { id, value: { amount: pence(50_000), currency: "GBP" } },
      "mia"
    );
    const approved = await run("approval.approve", { id: approval }, "max");
    const record = await server.pipeline.query(
      system.registry.get("deal_get") as AnyQueryDefinition,
      { id },
      people.ada as { actorId: string }
    );
    expect({ approved, record }).toMatchObject({
      approved: {
        ok: true,
        output: { ran: { ok: false, error: { code: "approval_required" } } },
      },
      record: { ok: true, output: { record: { archivedAt: null } } },
    });
  });
});
