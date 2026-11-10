import type { WorkflowDefinition } from "@workspace/workflows";
import { describe, expect, it } from "vitest";

import { ApiCallError } from "./api.ts";
import {
  changed,
  editBlock,
  isConflict,
  isDirty,
  newKeyProblem,
  newWorkflow,
  redone,
  startCopy,
  undone,
  withDescription,
  workflowPath,
} from "./workflow-edit.ts";

const first: WorkflowDefinition = {
  key: "deal_move_stage",
  description: "Move a deal.",
  starts_when: "called",
  steps: [{ output: {} }],
};

describe("the working copy", () => {
  it("undoes and redoes a change, and knows when there is something to save", () => {
    const start = startCopy(first);
    const edited = changed(start, withDescription(first, "Move it."));
    expect(isDirty(start)).toBeFalsy();
    expect(isDirty(edited)).toBeTruthy();
    expect(undone(edited).value.description).toBe("Move a deal.");
    expect(isDirty(undone(edited))).toBeFalsy();
    expect(redone(undone(edited)).value.description).toBe("Move it.");
  });

  it("keeps no step for a change that changes nothing, and drops redo on a new change", () => {
    const start = startCopy(first);
    expect(changed(start, { ...first })).toBe(start);
    const back = undone(changed(start, withDescription(first, "One.")));
    expect(changed(back, withDescription(first, "Two.")).future).toStrictEqual(
      []
    );
    expect(undone(start)).toBe(start);
    expect(redone(start)).toBe(start);
  });
});

describe("whether a workflow can be edited", () => {
  const open = {
    editable: true,
    canSave: true,
    version: "draft",
    inDraft: true,
  };

  it("says why not, or nothing when it can", () => {
    expect(editBlock(open)).toBeNull();
    expect(editBlock({ ...open, editable: false })).toBe("");
    expect(editBlock({ ...open, canSave: false })).toContain("roles");
    expect(editBlock({ ...open, version: undefined })).toContain("draft");
    expect(
      editBlock({ ...open, version: undefined, inDraft: false })
    ).toBeNull();
  });

  it("tells a conflict from any other failure", () => {
    const conflict = new ApiCallError(
      { code: "conflict", message: "The file changed." },
      409
    );
    expect(isConflict(conflict)).toBeTruthy();
    expect(isConflict(new Error("No network"))).toBeFalsy();
  });
});

describe("a new workflow", () => {
  it("checks the key", () => {
    expect(newKeyProblem("", [])).toBe("Give it a key.");
    expect(newKeyProblem("Deal Won", [])).toContain("lower-case");
    expect(newKeyProblem("deal_won", ["deal_won"])).toContain("already");
    expect(newKeyProblem("deal_won_2", ["deal_won"])).toBeNull();
  });

  it("starts when called or on an event, with one step", () => {
    const called = newWorkflow({ key: "a", description: "A.", event: null });
    const onEvent = newWorkflow({
      key: "b",
      description: "B.",
      event: "deal_updated",
    });
    expect(called.starts_when).toBe("called");
    expect(onEvent.starts_when).toStrictEqual({ event: "deal_updated" });
    expect(called.steps).toStrictEqual([{ output: {} }]);
  });
});

describe("the file a workflow is saved to", () => {
  it("is under config/workflows", () => {
    expect(workflowPath("deal_won_task")).toBe(
      "config/workflows/deal_won_task.yaml"
    );
  });
});
