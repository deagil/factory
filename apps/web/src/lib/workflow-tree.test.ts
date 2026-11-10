import type { WorkflowDefinition } from "@workspace/workflows";
import { describe, expect, it } from "vitest";

import {
  allRows,
  findRow,
  groupsAround,
  outlineMove,
  pathView,
  readCollapsed,
  rowName,
  stepDetail,
  stepWords,
  toggled,
  visibleRows,
  workflowTree,
} from "./workflow-tree.ts";

const moveStage: WorkflowDefinition = {
  key: "deal_move_stage",
  description: "Move a deal to another stage.",
  starts_when: "called",
  on_failure: [{ id: "tell", action: "task_create" }],
  attention_role: "manager",
  steps: [
    { id: "load", action: "deal_get", with: { id: { from: "input.deal" } } },
    {
      id: "check_reason",
      if: [
        { field: "input.stage.category", is: "lost" },
        { field: "input.reason", empty: true },
      ],
      // oxlint-disable-next-line unicorn/no-thenable -- a step's branch, not a promise
      then: [{ fail: "reason_required" }],
      else: [{ id: "pause", wait: { for: "3d" } }],
    },
    {
      id: "update",
      action: "deal_update",
      on_failure: [{ id: "undo", action: "deal_update" }],
    },
    { output: { deal: { from: "steps.update.output.record" } } },
  ],
};

const tree = workflowTree(moveStage);
const [first] = tree.rows;
if (!first) {
  throw new Error("The workflow has steps");
}

describe(workflowTree, () => {
  it("walks every step with its path, nested ones included", () => {
    expect(allRows(tree).map((row) => [row.address, row.path])).toStrictEqual([
      ["load", "steps.0"],
      ["check_reason", "steps.1"],
      ["steps.1.then.0", "steps.1.then.0"],
      ["pause", "steps.1.else.0"],
      ["update", "steps.2"],
      ["undo", "steps.2.on_failure.0"],
      ["steps.3", "steps.3"],
      ["tell", "on_failure.0"],
    ]);
    expect(tree.attentionRole).toBe("manager");
  });

  it("finds a step by its id or its path, and marks the ones that end the run", () => {
    expect(findRow(tree, "pause")?.path).toBe("steps.1.else.0");
    expect(findRow(tree, "steps.1.then.0")?.ends).toBeTruthy();
    expect(findRow(tree, "nope")).toBeUndefined();
    expect(workflowTree(null).rows).toStrictEqual([]);
  });

  it("hides the rows of a collapsed branch", () => {
    const collapsed = new Set(["steps.1.then", "on_failure"]);
    expect(
      visibleRows(tree, collapsed).map((row) => row.address)
    ).toStrictEqual([
      "load",
      "check_reason",
      "pause",
      "update",
      "undo",
      "steps.3",
    ]);
    expect(groupsAround("steps.1.then.0")).toStrictEqual(["steps.1.then"]);
  });
});

describe(stepWords, () => {
  it("says what each of the eight kinds does", () => {
    expect(
      [
        { id: "a", action: "deal_get" },
        {
          id: "b",
          if: [{ field: "input.reason", empty: true }],
          // oxlint-disable-next-line unicorn/no-thenable -- a step's branch, not a promise
          then: [{ fail: "x" }],
        },
        { id: "c", wait: { for: "3d" } },
        { id: "d", wait: { until: { from: "input.due" } } },
        { id: "e", wait_for_approval: { approver: "manager", approvals: 2 } },
        { id: "f", run: "deal_move_stage" },
        { id: "g", emit: "deal_stage_changed" },
        { fail: "reason_required" },
        { output: {} },
      ].map((step) => stepWords(step))
    ).toStrictEqual([
      "Runs deal get",
      "If the reason is empty",
      "Waits 3 days",
      "Waits until the due from the input",
      "Waits for 2 approvals from the manager role",
      "Runs the workflow deal move stage and waits for it",
      "Emits deal stage changed",
      "Fails with reason required",
      "Gives back its output",
    ]);
  });

  it("names a row by its place, its title, what it does and its kind", () => {
    expect(
      rowName(
        allRows(tree).find((row) => row.path === "steps.1.then.0") ?? first
      )
    ).toBe("Step 1 of 1, Fail, Fails with reason required, fail, ends the run");
  });

  it("lists a step's inputs and where each comes from", () => {
    expect(stepDetail(first.step).inputs).toStrictEqual([
      { name: "id", words: "the deal from the input", reads: null },
    ]);
    expect(
      stepDetail(findRow(tree, "check_reason")?.step ?? first.step).conditions
    ).toStrictEqual(["the stage's category is lost", "the reason is empty"]);
  });
});

describe(outlineMove, () => {
  const none = new Set<string>();

  it("moves down and up through the rows on screen", () => {
    expect(
      outlineMove({ tree, collapsed: none, path: "steps.1", key: "ArrowDown" })
    ).toStrictEqual({ focus: "steps.1.then.0" });
    expect(
      outlineMove({
        tree,
        collapsed: new Set(["steps.1.then", "steps.1.else"]),
        path: "steps.1",
        key: "ArrowDown",
      })
    ).toStrictEqual({ focus: "steps.2" });
    expect(
      outlineMove({ tree, collapsed: none, path: "steps.0", key: "ArrowUp" })
    ).toBeNull();
  });

  it("closes a branch with left and opens it with right", () => {
    expect(
      outlineMove({ tree, collapsed: none, path: "steps.1", key: "ArrowLeft" })
    ).toStrictEqual({ collapse: "steps.1.then" });
    expect(
      outlineMove({
        tree,
        collapsed: new Set(["steps.1.then"]),
        path: "steps.1",
        key: "ArrowRight",
      })
    ).toStrictEqual({ expand: "steps.1.then" });
    expect(
      outlineMove({ tree, collapsed: none, path: "steps.0", key: "ArrowLeft" })
    ).toBeNull();
  });

  it("keeps collapsed branches as a list, and reads anything else as none", () => {
    expect([...toggled(new Set(["a"]), "b")]).toStrictEqual(["a", "b"]);
    expect([...toggled(new Set(["a"]), "a")]).toStrictEqual([]);
    expect([...readCollapsed('["steps.1.then", 3]')]).toStrictEqual([
      "steps.1.then",
    ]);
    expect([...readCollapsed("not json")]).toStrictEqual([]);
  });
});

describe("one path on its own", () => {
  it("names the path, its steps and the condition's other path", () => {
    const view = pathView(tree, "steps.1.else");
    expect(view?.label).toBe("Otherwise");
    expect(view?.owner.id).toBe("check_reason");
    expect(view?.rows.map((row) => row.id)).toStrictEqual(["pause"]);
    expect(view?.other).toStrictEqual({ path: "steps.1.then", label: "Then" });
    expect(view?.after).toBe("Joins the main path again at Update.");
  });

  it("says when a path stops the run, and that failure steps go nowhere", () => {
    expect(pathView(tree, "steps.1.then")?.after).toBe(
      "The run stops at the end of this path."
    );
    const failure = pathView(tree, "steps.2.on_failure");
    expect(failure?.other).toBeNull();
    expect(failure?.after).toBe(
      "The run has failed. Nothing follows these steps."
    );
  });

  it("joins after the outer condition when the inner one is last", () => {
    const nested = workflowTree({
      ...moveStage,
      steps: [
        {
          id: "outer",
          if: [{ field: "input.reason", empty: true }],
          // oxlint-disable-next-line unicorn/no-thenable -- a step's branch, not a promise
          then: [
            {
              id: "inner",
              if: [{ field: "input.reason", empty: true }],
              // oxlint-disable-next-line unicorn/no-thenable -- a step's branch, not a promise
              then: [{ id: "note", action: "task_create" }],
            },
          ],
        },
        { id: "last", action: "deal_update" },
      ],
    });
    expect(pathView(nested, "steps.0.then.0.then")?.joins?.id).toBe("last");
    expect(pathView(nested, "steps.0.then.0.else")?.rows).toStrictEqual([]);
    expect(pathView(nested, "steps.1.else")).toBeUndefined();
    expect(pathView(nested, "steps.9.then")).toBeUndefined();
  });
});
