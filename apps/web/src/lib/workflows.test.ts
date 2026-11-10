import type { Step } from "@workspace/workflows";
import { describe, expect, it } from "vitest";

import {
  canReadWorkflows,
  draftChangeLabel,
  draftChangesWorkflow,
  presentWorkflow,
  readOnlyReason,
  showsReadOnly,
  sourceLabel,
  stepLabel,
  versionForChange,
  whatStarts,
  workflowMissing,
  workflowPageSearch,
  workflowReadInput,
} from "./workflows.ts";

describe(canReadWorkflows, () => {
  it("is true only when the caller may call workflow_list", () => {
    expect({
      reader: canReadWorkflows([{ key: "workflow_list" }]),
      caller: canReadWorkflows([{ key: "deal_move_stage" }]),
      none: canReadWorkflows(undefined),
    }).toStrictEqual({ reader: true, caller: false, none: false });
  });
});

describe(whatStarts, () => {
  it("names a call, an event, a conditioned event and a schedule", () => {
    expect(whatStarts("called")).toBe("When someone runs it");
    expect(whatStarts({ event: "deal_stage_changed" })).toBe(
      "When deal_stage_changed"
    );
    expect(
      whatStarts({
        event: "deal_updated",
        when: [{ field: "event.after.owner", empty: false }],
      })
    ).toBe("When deal_updated, if conditions hold");
    expect(whatStarts({ schedule: "0 9 * * 1-5" })).toBe(
      "On the schedule 0 9 * * 1-5"
    );
    expect(whatStarts(null)).toBe("Unknown start");
  });
});

describe(sourceLabel, () => {
  it("says Code or Config", () => {
    expect(sourceLabel("code")).toBe("Code");
    expect(sourceLabel("config")).toBe("Config");
  });
});

describe(draftChangeLabel, () => {
  it("says what the draft did, and nothing when it didn't", () => {
    expect({
      added: draftChangeLabel("added"),
      changed: draftChangeLabel("changed"),
      removed: draftChangeLabel("removed"),
      none: draftChangeLabel(null),
    }).toStrictEqual({
      added: "Added in your draft",
      changed: "Changed in your draft",
      removed: "Removed in your draft",
      none: null,
    });
  });

  it("is a change when the draft added, changed or removed the workflow", () => {
    expect(draftChangesWorkflow("changed")).toBeTruthy();
    expect(draftChangesWorkflow(null)).toBeFalsy();
  });
});

describe(workflowMissing, () => {
  it("names the side that does not have the workflow", () => {
    expect(workflowMissing("added", undefined)).toBe("only_in_draft");
    expect(workflowMissing("added", "draft")).toBeNull();
    expect(workflowMissing("removed", "draft")).toBe("removed_in_draft");
    expect(workflowMissing("removed", undefined)).toBeNull();
    expect(workflowMissing("changed", "draft")).toBeNull();
  });
});

describe(versionForChange, () => {
  it("opens an added or changed workflow on the draft", () => {
    expect(versionForChange("added")).toBe("draft");
    expect(versionForChange("changed")).toBe("draft");
    expect(versionForChange("removed")).toBeUndefined();
    expect(versionForChange(null)).toBeUndefined();
  });
});

describe(readOnlyReason, () => {
  it("explains each reason a workflow can't be changed here", () => {
    expect(readOnlyReason("code")).toBe(
      "Written in code and shipped with a release, so it can't be changed here."
    );
    expect(readOnlyReason("no_config_remote")).toBe(
      "This system reads config from its working tree, so it can't be changed here."
    );
    expect(readOnlyReason("past_version")).toBe(
      "This is a past version, so it can't be changed here."
    );
    expect(readOnlyReason(null)).toBeNull();
  });

  it("marks a read-only workflow and a view that can't be edited", () => {
    expect({
      editable: showsReadOnly(false, null),
      reads: showsReadOnly(true, null),
      past: showsReadOnly(false, "past_version"),
    }).toStrictEqual({ editable: false, reads: true, past: true });
  });
});

describe(workflowPageSearch, () => {
  it("keeps the file tab, a step and a draft or sha, and drops the rest", () => {
    const sha = "a".repeat(40);
    expect(
      workflowPageSearch({ tab: "file", step: "update", v: "draft", extra: 1 })
    ).toStrictEqual({ tab: "file", step: "update", v: "draft" });
    expect(workflowPageSearch({ tab: "changes", v: sha })).toStrictEqual({
      v: sha,
    });
    expect(
      workflowPageSearch({ tab: "workflow", v: "live", step: "" })
    ).toStrictEqual({});
  });
});

describe(workflowReadInput, () => {
  it("sends a draft id, a sha, or neither for live", () => {
    expect(
      workflowReadInput("deal_move_stage", "draft", "draft-1")
    ).toStrictEqual({
      key: "deal_move_stage",
      draft_id: "draft-1",
    });
    expect(
      workflowReadInput("deal_move_stage", "draft", undefined)
    ).toStrictEqual({ key: "deal_move_stage" });
    const sha = "b".repeat(40);
    expect(workflowReadInput("deal_move_stage", sha, "draft-1")).toStrictEqual({
      key: "deal_move_stage",
      sha,
    });
    expect(
      workflowReadInput("deal_move_stage", undefined, "draft-1")
    ).toStrictEqual({ key: "deal_move_stage" });
  });
});

describe(presentWorkflow, () => {
  it("reads the list row until the workflow itself has loaded", () => {
    const item = {
      key: "deal_won_task",
      label: "Won task",
      description: "Thank the customer.",
      source: "config" as const,
      path: "config/workflows/deal_won_task.yaml",
      starts_when: { event: "deal_stage_changed" },
      read_only: false,
      emits: [],
      runs: [],
      problems: 0,
      warnings: 0,
      change: "added" as const,
    };
    expect(
      presentWorkflow({
        key: "deal_won_task",
        search: { v: "draft" },
        item,
        view: undefined,
        missing: null,
      })
    ).toMatchObject({
      label: "Won task",
      description: "Thank the customer.",
      source: "config",
      readOnly: false,
      starts: "When deal_stage_changed",
      tab: "workflow",
      missingText: null,
      content: null,
    });
  });

  it("says when the open version does not have the workflow", () => {
    expect(
      presentWorkflow({
        key: "deal_won_task",
        search: {},
        item: undefined,
        view: undefined,
        missing: "only_in_draft",
      }).missingText
    ).toBe("This workflow is only in your draft.");
  });
});

describe(stepLabel, () => {
  it("uses the id, and the fail code or output when there is none", () => {
    const steps: Step[] = [
      { id: "load", action: "deal_get" },
      // oxlint-disable-next-line unicorn/no-thenable -- a step's branch, not a promise
      { id: "check", if: [], then: [] },
      { id: "pause", wait: { for: "3d" } },
      { id: "ask", wait_for_approval: { approver: "admin" } },
      { id: "child", run: "deal_won_task" },
      { id: "tell", emit: "deal_stage_changed" },
      { fail: "reason_required" },
      { id: "done", output: {} },
      { output: {} },
    ];
    expect(steps.map((step) => stepLabel(step))).toStrictEqual([
      "load",
      "check",
      "pause",
      "ask",
      "child",
      "tell",
      "reason_required",
      "done",
      "output",
    ]);
  });
});
