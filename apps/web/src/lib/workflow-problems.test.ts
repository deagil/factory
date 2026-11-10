import type { WorkflowCheck, WorkflowDefinition } from "@workspace/workflows";
import { describe, expect, it } from "vitest";

import {
  countWords,
  findingsByRow,
  findingsOf,
  findingsUnder,
} from "./workflow-problems.ts";
import { readersOf, stepDetail, workflowTree } from "./workflow-tree.ts";

const definition: WorkflowDefinition = {
  key: "deal_move_stage",
  description: "Move a deal.",
  starts_when: "called",
  steps: [
    { id: "load", action: "deal_get", with: { id: { from: "input.deal" } } },
    {
      id: "check",
      if: [{ field: "steps.load.output.record.stage", is: "won" }],
      // oxlint-disable-next-line unicorn/no-thenable -- a step's branch, not a promise
      then: [{ id: "nope", action: "no_such_action" }],
    },
    {
      id: "announce",
      emit: "deal_stage_changed",
      with: { from: { from: "steps.load.output.record.stage" } },
    },
  ],
  output: { deal: { from: "steps.load.output.record" } },
};

const tree = workflowTree(definition);

const check: WorkflowCheck = {
  problems: [
    {
      path: ["steps", 1, "then", 0, "action"],
      message: "No action no_such_action.",
    },
    { path: ["description"], message: "Say more." },
  ],
  warnings: [{ path: ["steps", 2, "with", "from"], message: "Looks odd." }],
  segments: [],
  scopes: {
    steps: {},
    outputs: {},
    input: null,
    event: null,
    eventSchema: null,
  },
};

describe(findingsOf, () => {
  const findings = findingsOf(tree, check);

  it("puts each problem on the deepest step its path reaches, with its field", () => {
    expect(
      findings.map((each) => [each.kind, each.row?.address ?? null, each.field])
    ).toStrictEqual([
      ["problem", "nope", "action"],
      ["problem", null, "description"],
      ["warning", "announce", "with.from"],
    ]);
    expect([...findingsByRow(findings).keys()]).toStrictEqual([
      "steps.1.then.0",
      "steps.2",
    ]);
  });

  it("counts them, and the ones inside a branch", () => {
    expect(countWords(findings)).toBe("2 problems, 1 warning");
    expect(countWords([])).toBeNull();
    const [group] = tree.rows[1]?.groups ?? [];
    expect(group ? findingsUnder(group, findings) : []).toHaveLength(1);
  });
});

describe(readersOf, () => {
  it("lists the steps that read each step, and the output's reads", () => {
    expect(
      (readersOf(tree).get("load") ?? []).map((row) => row.address)
    ).toStrictEqual(["check", "announce"]);
    expect(tree.outputReads).toStrictEqual(["load"]);
    expect(
      stepDetail(definition.steps[2] ?? { output: {} }).inputs
    ).toStrictEqual([
      {
        name: "from",
        words: "the record's stage from the step Load",
        reads: "load",
      },
    ]);
  });
});
