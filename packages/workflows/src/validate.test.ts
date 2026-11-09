import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { defineAction, stepActions } from "@workspace/actions";
import {
  choiceConfigType,
  roleConfigType,
  validateConfig,
} from "@workspace/config";
import type { ConfigCatalog } from "@workspace/config";
import { defineChoiceList, defineObject, f } from "@workspace/objects/define";
import { afterAll, describe, expect, it } from "vitest";
import { z } from "zod";

import { workflowConfigType } from "./config-type.ts";
import { defineWorkflow } from "./define-workflow.ts";
import type { WorkflowInput } from "./define-workflow.ts";
import type { Step as WorkflowStep } from "./schema.ts";
import { validateWorkflow } from "./validate.ts";

const dealStages = defineChoiceList({
  key: "deal_stages",
  columns: { category: z.enum(["open", "won", "lost"]) },
});

const deal = defineObject({
  name: "deal",
  fields: {
    name: f.text({ required: true }),
    owner: f.ref("actor"),
    stage: f.choice(dealStages, { required: true }),
  },
  owner: "owner",
});

const payment = defineObject({
  name: "payment",
  fields: {
    amount: f.number({ required: true }),
    status: f.text({ required: true }),
    owner: f.ref("actor"),
  },
  owner: "owner",
});

const external = (
  name: string,
  input: z.ZodObject,
  output: z.ZodObject,
  fixedInputs: string[] = []
) =>
  defineAction({
    name,
    kind: "external",
    description: name,
    input,
    output,
    fixedInputs,
    handler: () => ({}) as never,
  });

const catalog: ConfigCatalog = {
  objects: new Map([
    ["deal", Object.keys(deal.fields)],
    ["payment", Object.keys(payment.fields)],
  ]),
  actions: new Set(),
  objectActions: new Map(),
  owners: new Set(["deal", "payment"]),
  events: new Set(),
  choiceLists: [
    {
      key: "deal_stages",
      keys: undefined,
      option: dealStages.option,
      usedBy: ["deal.stage"],
    },
  ],
  stepActions: new Map(
    [
      ...stepActions([deal, payment]),
      external(
        "payment_authorise",
        z.object({ payment: z.uuid(), amount: z.number() }),
        z.object({ authorisation: z.string() })
      ),
      external(
        "payment_capture",
        z.object({ authorisation: z.string() }),
        z.object({ captured: z.boolean() })
      ),
      external(
        "payment_reverse",
        z.object({ authorisation: z.string() }),
        z.object({})
      ),
      external(
        "http_send",
        z.object({ url: z.url(), body: z.json() }),
        z.object({ status: z.number() }),
        ["url"]
      ),
    ].map((action) => [action.name, action])
  ),
};

const dealMoveStage = `key: deal_move_stage
description: Move a deal to another stage. A lost deal needs a reason.
starts_when: called
input:
  deal: { type: ref, object: deal }
  stage: { type: choice, list: deal_stages }
  reason: { type: text, optional: true }
errors:
  reason_required: A lost deal needs a reason.
events:
  deal_stage_changed:
    deal: { type: ref, object: deal }
    from: { type: choice, list: deal_stages }
    to: { type: choice, list: deal_stages }
steps:
  - id: load
    action: deal_get
    with: { id: { from: input.deal } }
  - id: check_reason
    if:
      - { field: input.stage.category, is: lost }
      - { field: input.reason, empty: true }
    then:
      - fail: reason_required
  - id: update
    action: deal_update
    with:
      id: { from: input.deal }
      stage: { from: input.stage }
  - id: announce
    emit: deal_stage_changed
    with:
      deal: { from: input.deal }
      from: { from: steps.load.output.record.stage }
      to: { from: input.stage }
output:
  deal: { from: steps.update.output.record }
`;

/** Each problem: a step input from a mismatched type, an unknown action, an unknown option and a URL from data. */
const broken = `key: deal_broken
description: Everything wrong at once.
starts_when: called
input:
  deal: { type: ref, object: deal }
  reason: { type: text }
attention_role: admin
steps:
  - id: check
    action: within_limit
    with: { value: { from: input.reason }, max: { value: 10 } }
  - id: check_stage
    if: [{ field: input.deal, is: 3 }]
    then:
      - id: teleport
        action: deal_teleport
  - id: notify
    action: http_send
    with: { url: { from: input.reason }, body: { value: {} } }
`;

const stages = `key: deal_stages
options:
  - { key: proposal, label: Proposal, category: open }
  - { key: won, label: Won, category: won }
  - { key: lost, label: Lost, category: lost }
`;

const types = [choiceConfigType, roleConfigType, workflowConfigType];

const lineOf = (text: string, needle: string) =>
  text.split("\n").findIndex((line) => line.includes(needle)) + 1;

const paymentMake = (
  change: (steps: readonly WorkflowStep[]) => readonly WorkflowStep[] = (
    steps
  ) => steps,
  extra: Partial<WorkflowInput> = {}
) =>
  defineWorkflow({
    key: "payment_make",
    description: "Authorise a payment, wait a day, then take it.",
    starts_when: "called",
    input: {
      payment: { type: "ref", object: "payment" },
      amount: { type: "number" },
    },
    events: {
      payment_made: {
        payment: { type: "ref", object: "payment" },
        amount: { type: "number" },
      },
    },
    attention_role: "finance",
    steps: change([
      {
        id: "check_owner",
        action: "record_belongs_to_caller",
        with: {
          object: { value: "payment" },
          id: { from: "input.payment" },
        },
      },
      {
        id: "check_amount",
        action: "within_limit",
        with: { value: { from: "input.amount" }, max: { value: 10_000 } },
      },
      {
        id: "authorise",
        action: "payment_authorise",
        with: {
          payment: { from: "input.payment" },
          amount: { from: "input.amount" },
        },
      },
      { id: "wait_a_day", wait: { for: "1d" } },
      {
        id: "still_pending",
        action: "record_in_state",
        with: {
          object: { value: "payment" },
          id: { from: "input.payment" },
          field: { value: "status" },
          is: { value: "pending" },
        },
        on_failure: [
          {
            id: "reverse_stale",
            action: "payment_reverse",
            with: {
              authorisation: { from: "steps.authorise.output.authorisation" },
            },
          },
        ],
      },
      {
        id: "capture",
        action: "payment_capture",
        with: {
          authorisation: { from: "steps.authorise.output.authorisation" },
        },
        on_failure: [
          {
            id: "reverse",
            action: "payment_reverse",
            with: {
              authorisation: { from: "steps.authorise.output.authorisation" },
            },
          },
        ],
      },
      {
        id: "mark_paid",
        action: "payment_update",
        with: { id: { from: "input.payment" }, status: { value: "paid" } },
        on_failure: "leave",
      },
      {
        id: "announce",
        emit: "payment_made",
        with: {
          payment: { from: "input.payment" },
          amount: { from: "input.amount" },
        },
      },
    ]),
    output: { captured: { from: "steps.capture.output.captured" } },
    ...extra,
  });

describe("workflow definitions (P2.16)", () => {
  const root = mkdtempSync(path.join(tmpdir(), "workflows-"));
  const dir = path.join(root, "config");
  const write = (file: string, text: string) => {
    mkdirSync(path.join(dir, file, ".."), { recursive: true });
    writeFileSync(path.join(dir, file), text);
  };

  afterAll(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it("validates a YAML deal_move_stage, and names the file and line of each problem in another", () => {
    write("choices/deal_stages.yaml", stages);
    write("workflows/deal_move_stage.yaml", dealMoveStage);
    write("workflows/deal_broken.yaml", broken);
    write("roles/admin.yaml", "key: admin\nlabel: Admin\n");
    const { files, problems } = validateConfig(dir, types, catalog);
    const good = files.find((file) => file.key === "deal_move_stage");
    const check = validateWorkflow(good?.value as never, { catalog });
    expect(
      problems.map(({ file, line, message }) => ({ file, line, message }))
    ).toStrictEqual([
      {
        file: "config/workflows/deal_broken.yaml",
        line: lineOf(broken, "value: { from: input.reason }"),
        message:
          "within_limit's value takes a number, but input.reason is text.",
      },
      {
        file: "config/workflows/deal_broken.yaml",
        line: lineOf(broken, "is: 3"),
        message: "input.deal holds text, so it is never 3.",
      },
      {
        file: "config/workflows/deal_broken.yaml",
        line: lineOf(broken, "deal_teleport"),
        message:
          'There is no action "deal_teleport". fx describe lists the step actions.',
      },
      {
        file: "config/workflows/deal_broken.yaml",
        line: lineOf(broken, "url: { from"),
        message:
          "http_send's url must be a fixed value in this file, never from data, so a record or event can't change where it goes.",
      },
    ]);
    expect(check.segments).toStrictEqual([
      {
        steps: ["load", "check_reason", "update", "announce"],
        queued: [],
        ends: null,
      },
    ]);
    expect(check.warnings.map((each) => each.message)).toStrictEqual([
      "input.deal takes a deal id, but no step checks it belongs to the caller (record_belongs_to_caller), so anyone who may call this workflow can act on any deal.",
    ]);
  });

  it("validates a TypeScript payment_make built from fake actions, and finds where it commits", () => {
    const check = validateWorkflow(paymentMake(), { catalog });
    expect(check.problems).toStrictEqual([]);
    expect(check.warnings).toStrictEqual([]);
    expect(
      check.segments.map(({ steps, ends }) => [
        steps.join(" "),
        ends ? `${ends.step}: ${ends.why}` : null,
      ])
    ).toStrictEqual([
      [
        "check_owner check_amount",
        "authorise: runs outside the transaction, and a later step reads its output",
      ],
      ["", "wait_a_day: waits"],
      [
        "still_pending",
        "capture: runs outside the transaction, and a later step reads its output",
      ],
      ["mark_paid announce", null],
    ]);
  });

  it("needs a way out for a step that fails after a commit, and a role for runs that need attention", () => {
    const withoutWayOut = paymentMake(
      (steps) =>
        steps.map((step) =>
          "id" in step && step.id === "capture"
            ? { ...step, on_failure: undefined }
            : step
        ),
      { attention_role: undefined }
    );
    const { problems } = validateWorkflow(withoutWayOut, { catalog });
    expect(
      problems.map((problem) => [problem.path.join("."), problem.message])
    ).toStrictEqual([
      [
        "steps.5",
        "payment_capture can fail after earlier changes are committed, so it needs on_failure: steps that undo them, or on_failure: leave to keep them.",
      ],
      [
        "steps",
        "This workflow may commit and go on later, so it needs attention_role: the role whose inbox gets a run that fails after a commit.",
      ],
    ]);
  });

  it("proves a read_only workflow never writes, and refuses a value from a step that may not have run", () => {
    const listDeals = defineWorkflow({
      key: "deal_overview",
      description: "A deal and whatever a branch read.",
      starts_when: "called",
      read_only: true,
      input: { deal: { type: "ref", object: "deal" } },
      steps: [
        {
          id: "maybe",
          if: [{ field: "input.deal", empty: false }],
          // oxlint-disable-next-line unicorn/no-thenable -- a step's branch
          then: [
            {
              id: "load",
              action: "deal_get",
              with: { id: { from: "input.deal" } },
            },
          ],
        },
        {
          id: "touch",
          action: "deal_update",
          with: { id: { from: "input.deal" } },
        },
      ],
      output: { deal: { from: "steps.load.output.record" } },
    });
    const { problems } = validateWorkflow(listDeals, { catalog });
    expect(problems.map((each) => each.message)).toStrictEqual([
      "deal_update writes, so a read_only workflow can't run it.",
      'Step "load" may not have run by here: it comes later, or in a branch that may not run.',
    ]);
  });

  it("refuses a definition whose shape is wrong, saying where", () => {
    expect(() =>
      defineWorkflow({
        key: "Bad Name",
        description: "x",
        starts_when: "called",
        steps: [{ id: "a", wait: { for: "soon" } }],
      })
    ).toThrow(/snake_case[\s\S]*key/u);
  });
});
