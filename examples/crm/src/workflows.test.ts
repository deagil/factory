// The runner (P2.17) on the CRM's config/workflows/deal_move_stage.yaml,
// against a database built from migrations.
import type { AnyActionDefinition, ConfigService } from "@workspace/actions";
import { testAction } from "@workspace/actions/testing";
import {
  choiceConfigType,
  choiceLookup,
  readConfig,
  valuesOf,
} from "@workspace/config";
import { bootstrapStaff } from "@workspace/db";
import { eventLog, runSteps, runs } from "@workspace/db/schema";
import { createSystemDatabase } from "@workspace/server/testing";
import type { SystemDatabase } from "@workspace/server/testing";
import {
  createRunner,
  defineWorkflow,
  workflowsIn,
} from "@workspace/workflows";
import type { Runner, WorkflowDefinition } from "@workspace/workflows";
import { asc, eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { deals, organisations } from "./objects.ts";
import { crm } from "./system.ts";

const { files } = readConfig(crm.config ?? "", crm.configTypes);
const workflows = workflowsIn(files);
const dealMoveStage = workflows.get("deal_move_stage") as WorkflowDefinition;
const config: ConfigService = {
  sha: "test",
  roles: [],
  choices: choiceLookup(valuesOf(files, choiceConfigType)),
};

const stepAction = (name: string) =>
  crm.stepActions.get(name) as AnyActionDefinition;

/** Renames an organisation, then moves a deal: a nested workflow. */
const renameThenMove = defineWorkflow({
  key: "organisation_rename_then_move",
  description: "Rename an organisation, then move one of its deals.",
  starts_when: "called",
  input: {
    organisation: { type: "ref", object: "organisation" },
    deal: { type: "ref", object: "deal" },
    stage: { type: "choice", list: "deal_stages" },
  },
  steps: [
    {
      id: "rename",
      action: "organisation_update",
      with: {
        id: { from: "input.organisation" },
        name: { value: "Renamed" },
      },
    },
    {
      id: "move",
      run: "deal_move_stage",
      with: { deal: { from: "input.deal" }, stage: { from: "input.stage" } },
    },
  ],
});

describe("the runner (P2.17)", () => {
  let database: SystemDatabase;
  let runner: Runner;
  let caller: { id: string; userId: string };
  let organisationId = "";
  let dealId = "";
  // Each reading is a millisecond later, so steps sort in the order they ran.
  let tick = Date.parse("2026-11-09T12:00:00Z");
  const clock = { now: () => new Date((tick += 1)) };

  const run = (workflow: WorkflowDefinition, input: unknown) =>
    runner.run(workflow, input, {
      originUserId: caller.userId,
      config,
      workflows,
    });

  const traceOf = async (runId: string) => {
    const { db } = database;
    const [row] = await db.select().from(runs).where(eq(runs.id, runId));
    const steps = await db
      .select()
      .from(runSteps)
      .where(eq(runSteps.runId, runId))
      .orderBy(asc(runSteps.position), asc(runSteps.startedAt));
    const events = await db
      .select()
      .from(eventLog)
      .where(eq(eventLog.runId, runId));
    return { run: row, steps, events };
  };

  const stageOfDeal = async () => {
    const [row] = await database.db
      .select({ stage: deals.stage })
      .from(deals)
      .where(eq(deals.id, dealId));
    return row?.stage;
  };

  beforeAll(async () => {
    database = await createSystemDatabase(crm);
    const { db } = database;
    caller = await bootstrapStaff(db, {
      name: "Sam Sales",
      email: "sam@example.com",
      roles: ["sales"],
    });
    runner = createRunner({ db, actions: crm.stepActions, clock });
    const as = {
      actor: { id: caller.id, kind: "staff" as const, name: "Sam Sales" },
      config,
      clock,
    };
    const organisation = await testAction(
      db,
      stepAction("organisation_create"),
      { name: "Acme" },
      as
    );
    organisationId = organisation.ok
      ? (organisation.output as { record: { id: string } }).record.id
      : "";
    const deal = await testAction(
      db,
      stepAction("deal_create"),
      { name: "Big deal", organisation: organisationId, stage: "proposal" },
      as
    );
    dealId = deal.ok
      ? (deal.output as { record: { id: string } }).record.id
      : "";
  });

  afterAll(async () => {
    await database?.close();
  });

  it("moves a deal and announces it in one run, as the workflow, tracing each step", async () => {
    const moved = await run(dealMoveStage, { deal: dealId, stage: "won" });
    const { run: row, steps, events } = await traceOf(moved.runId);
    const actor = await runner.actorOf("deal_move_stage");
    expect(moved).toMatchObject({
      ok: true,
      output: { deal: { id: dealId, stage: "won" } },
    });
    expect(row).toMatchObject({
      endpoint: "deal_move_stage",
      status: "succeeded",
      actorId: actor.id,
      originUserId: caller.userId,
    });
    expect(
      steps.map(({ stepId, kind, name, branch }) => [
        stepId,
        kind,
        name,
        branch,
      ])
    ).toStrictEqual([
      ["load", "action", "deal_get", null],
      ["check_reason", "control", "if", "else"],
      ["update", "action", "deal_update", null],
      ["announce", "control", "emit", null],
    ]);
    expect(steps.map((step) => step.input)).toMatchObject([
      { id: dealId },
      { "input.stage.category": "won", "input.reason": null },
      { id: dealId, stage: "won" },
      { deal: dealId, from: "proposal", to: "won" },
    ]);
    expect(events.map((event) => event.type)).toStrictEqual([
      "deal_updated",
      "deal_stage_changed",
    ]);
  });

  it("refuses a lost stage with no reason, changing nothing but keeping the trace", async () => {
    const refused = await run(dealMoveStage, { deal: dealId, stage: "lost" });
    const { run: row, steps, events } = await traceOf(refused.runId);
    expect(refused).toMatchObject({
      ok: false,
      error: {
        code: "reason_required",
        message: "A lost deal needs a reason.",
      },
    });
    expect([await stageOfDeal(), events]).toStrictEqual(["won", []]);
    expect(row).toMatchObject({
      status: "failed",
      error: { code: "reason_required" },
    });
    expect(
      steps.map(({ stepId, name, branch, error }) => [
        stepId,
        name,
        branch,
        error ? (error as { code: string }).code : null,
      ])
    ).toStrictEqual([
      ["load", "deal_get", null, null],
      ["check_reason", "if", "then", null],
      ["check_reason.then.0", "fail", null, "reason_required"],
    ]);
  });

  it("fails a parent when its nested workflow fails, undoing the parent's steps too", async () => {
    const failed = await run(renameThenMove, {
      organisation: organisationId,
      deal: dealId,
      stage: "lost",
    });
    const parent = await traceOf(failed.runId);
    const [child] = await database.db
      .select()
      .from(runs)
      .where(eq(runs.parentRunId, failed.runId));
    const [organisation] = await database.db
      .select({ name: organisations.name })
      .from(organisations)
      .where(eq(organisations.id, organisationId));
    expect(failed).toMatchObject({
      ok: false,
      error: { code: "reason_required" },
    });
    expect(organisation?.name).toBe("Acme");
    expect(
      parent.steps.map(({ stepId, name, error }) => [
        stepId,
        name,
        Boolean(error),
      ])
    ).toStrictEqual([
      ["rename", "organisation_update", false],
      ["move", "run", true],
    ]);
    expect(child).toMatchObject({
      endpoint: "deal_move_stage",
      status: "failed",
      depth: 1,
    });
  });
});
