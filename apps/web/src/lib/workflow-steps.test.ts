import type { WorkflowDefinition } from "@workspace/workflows";
import { describe, expect, it } from "vitest";

import {
  duplicateStep,
  idProblem,
  insertStep,
  listAt,
  moveBy,
  moveInto,
  moveOut,
  moveStep,
  newStep,
  removeStep,
  renameStep,
  stepAt,
  uniqueId,
} from "./workflow-steps.ts";

const start: WorkflowDefinition = {
  key: "deal_move_stage",
  description: "Move a deal.",
  starts_when: "called",
  input: { deal: { type: "text" } },
  steps: [
    { id: "load", action: "deal_get", with: { id: { from: "input.deal" } } },
    {
      id: "check",
      if: [{ field: "steps.load.output.record.stage", is: "lost" }],
      // oxlint-disable-next-line unicorn/no-thenable -- a step's branch, not a promise
      then: [{ id: "note", action: "task_create" }],
      else: [{ id: "pause", wait: { for: "3d" } }],
    },
    {
      id: "update",
      action: "deal_update",
      with: { id: { from: "steps.load.output.record.id" } },
      on_failure: [{ id: "undo", action: "deal_update" }],
    },
  ],
  output: { deal: { from: "steps.load.output.record" } },
};

const ids = (definition: WorkflowDefinition, list: string) =>
  listAt(definition, list).map((step) => ("id" in step ? step.id : undefined));

describe("putting steps in and taking them out", () => {
  it("inserts at a slot, in a nested path too", () => {
    const wait = newStep(start, { kind: "wait" });
    const top = insertStep(start, { list: "steps", index: 1 }, wait);
    const nested = insertStep(start, { list: "steps.1.then", index: 1 }, wait);
    expect(ids(top.definition, "steps")).toStrictEqual([
      "load",
      "wait",
      "check",
      "update",
    ]);
    expect(top.path).toBe("steps.1");
    expect(ids(nested.definition, "steps.1.then")).toStrictEqual([
      "note",
      "wait",
    ]);
  });

  it("removes a step, and drops an Otherwise or failure list it empties", () => {
    const noElse = removeStep(start, "steps.1.else.0");
    const noFailure = removeStep(start, "steps.2.on_failure.0");
    expect(stepAt(noElse, "steps.1")).not.toHaveProperty("else", [
      expect.anything(),
    ]);
    expect(listAt(noElse, "steps.1.else")).toStrictEqual([]);
    expect(listAt(noFailure, "steps.2.on_failure")).toStrictEqual([]);
    expect(ids(removeStep(start, "steps.0"), "steps")).toStrictEqual([
      "check",
      "update",
    ]);
  });
});

describe("moving a step", () => {
  it("moves from one path of a condition to the other", () => {
    const moved = moveStep(start, "steps.1.then.0", {
      list: "steps.1.else",
      index: 1,
    });
    expect(ids(moved?.definition ?? start, "steps.1.else")).toStrictEqual([
      "pause",
      "note",
    ]);
    expect(moved?.path).toBe("steps.1.else.1");
    expect(listAt(moved?.definition ?? start, "steps.1.then")).toStrictEqual(
      []
    );
  });

  it("lands in a later sibling's path, whose own path has moved up one", () => {
    const moved = moveStep(start, "steps.0", {
      list: "steps.1.then",
      index: 0,
    });
    expect(moved?.path).toBe("steps.0.then.0");
    expect(ids(moved?.definition ?? start, "steps.0.then")).toStrictEqual([
      "load",
      "note",
    ]);
  });

  it("refuses a move that changes nothing or goes inside itself", () => {
    expect(moveStep(start, "steps.1", { list: "steps", index: 2 })).toBeNull();
    expect(
      moveStep(start, "steps.1", { list: "steps.1.then", index: 0 })
    ).toBeNull();
    expect(moveBy(start, "steps.0", -1)).toBeNull();
    expect(moveBy(start, "steps.2", 1)).toBeNull();
    expect(moveOut(start, "steps.0")).toBeNull();
  });

  it("moves up, down, into the condition before and out again", () => {
    const down = moveBy(start, "steps.0", 1);
    expect(ids(down?.definition ?? start, "steps")).toStrictEqual([
      "check",
      "load",
      "update",
    ]);
    const into = moveInto(start, "steps.2");
    expect(into?.path).toBe("steps.1.then.1");
    const out = moveOut(into?.definition ?? start, "steps.1.then.1");
    expect(out?.path).toBe("steps.2");
    expect(out?.definition).toStrictEqual(start);
    expect(moveInto(start, "steps.1")).toBeNull();
  });
});

describe("ids", () => {
  it("copies a step with ids of its own", () => {
    const copy = duplicateStep(start, "steps.1");
    expect(copy?.path).toBe("steps.2");
    expect(stepAt(copy?.definition ?? start, "steps.2")).toMatchObject({
      id: "check_copy",
      // oxlint-disable-next-line unicorn/no-thenable -- a step's branch, not a promise
      then: [{ id: "note_copy" }],
      else: [{ id: "pause_copy" }],
    });
    expect(uniqueId(["wait", "wait_2"], "wait")).toBe("wait_3");
  });

  it("renames a step and everything that reads it", () => {
    const renamed = renameStep(start, "load", "fetch");
    expect(stepAt(renamed, "steps.0")).toMatchObject({ id: "fetch" });
    expect(stepAt(renamed, "steps.1")).toMatchObject({
      if: [{ field: "steps.fetch.output.record.stage" }],
    });
    expect(stepAt(renamed, "steps.2")).toMatchObject({
      with: { id: { from: "steps.fetch.output.record.id" } },
    });
    expect(renamed.output).toStrictEqual({
      deal: { from: "steps.fetch.output.record" },
    });
  });

  it("checks a new id", () => {
    expect(idProblem(start, "Load It", "load")).toContain("lower-case");
    expect(idProblem(start, "update", "load")).toContain("already");
    expect(idProblem(start, "load", "load")).toBeNull();
    expect(idProblem(start, "fetch", "load")).toBeNull();
  });
});

describe("a new step", () => {
  it("has an id no other step has, and a condition tests an input", () => {
    const again = insertStep(
      start,
      { list: "steps", index: 0 },
      newStep(start, { kind: "action", action: "deal_get" })
    ).definition;
    expect(
      newStep(again, { kind: "action", action: "deal_get" })
    ).toMatchObject({ id: "deal_get_2" });
    expect(newStep(start, { kind: "if" })).toMatchObject({
      id: "check_2",
      if: [{ field: "input.deal", empty: false }],
      // oxlint-disable-next-line unicorn/no-thenable -- a step's branch, not a promise
      then: [],
    });
  });
});
