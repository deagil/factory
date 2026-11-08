import { describe, expect, it } from "vitest";

import { approvalProgress, pillFor, publishLabel } from "./working-draft.ts";

describe(pillFor, () => {
  it("counts unpublished edits, and shows nothing for an empty draft", () => {
    expect({
      none: pillFor(null),
      empty: pillFor({ status: "draft", files: [] }),
      one: pillFor({ status: "valid", files: ["config/roles/a.yaml"] }),
      two: pillFor({
        status: "valid",
        files: ["config/roles/a.yaml", "config/roles/b.yaml"],
      }),
    }).toStrictEqual({
      none: null,
      empty: null,
      one: { label: "1 unpublished edit", tone: "edits" },
      two: { label: "2 unpublished edits", tone: "edits" },
    });
  });

  it("says when a draft waits for approval or has problems", () => {
    expect({
      waiting: pillFor(
        { status: "awaiting_approval", files: ["config/roles/a.yaml"] },
        { approved: 1, needed: 2 }
      ),
      problems: pillFor({ status: "invalid", files: ["config/roles/a.yaml"] }),
    }).toStrictEqual({
      waiting: { label: "Waiting for approval · 1 of 2", tone: "waiting" },
      problems: { label: "Draft has problems", tone: "problems" },
    });
  });
});

const signOff = (approverRole: string, approvals = 1) => ({
  rule: "r",
  label: "R",
  approverRole,
  approvals,
});

describe(publishLabel, () => {
  it("names who publishing will ask", () => {
    expect([
      publishLabel([]),
      publishLabel([signOff("admin")]),
      publishLabel([signOff("manager", 2)]),
      publishLabel([signOff("sales-lead"), signOff("finance")]),
    ]).toStrictEqual([
      "Publish",
      "Request approval from Admin",
      "Request 2 approvals from Manager",
      "Request 2 approvals from Sales lead and Finance",
    ]);
  });
});

describe(approvalProgress, () => {
  it("counts approvals still in play", () => {
    expect(
      approvalProgress([
        { status: "approved" },
        { status: "pending" },
        { status: "cancelled" },
      ])
    ).toStrictEqual({ approved: 1, needed: 2 });
  });
});
