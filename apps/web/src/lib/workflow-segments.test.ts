import type { WorkflowCheck } from "@workspace/workflows";
import { describe, expect, it } from "vitest";

import {
  callersWords,
  cutsOf,
  inputWarnings,
  pauseWords,
  queuedOf,
} from "./workflow-segments.ts";

const check: WorkflowCheck = {
  problems: [],
  warnings: [
    {
      path: ["input", "deal"],
      message: "No step checks it belongs to the caller.",
    },
    { path: ["steps", 1], message: "Something else." },
  ],
  segments: [
    {
      steps: ["owns", "first"],
      queued: ["tell"],
      ends: { step: "pause", why: "waits", conditional: false },
    },
    {
      steps: ["second"],
      queued: [],
      ends: { step: "ask", why: "waits for approval", conditional: true },
    },
    { steps: ["last"], queued: [], ends: null },
  ],
  scopes: {
    steps: {},
    outputs: {},
    input: null,
    event: null,
    eventSchema: null,
  },
};

describe(cutsOf, () => {
  it("says where a run commits, in the check's words", () => {
    expect([...cutsOf(check).values()].map((cut) => cut.text)).toStrictEqual([
      "Commits here: this step waits.",
      "Commits here: this step waits for approval. Only if this branch runs.",
    ]);
    expect([...queuedOf(check)]).toStrictEqual(["tell"]);
    expect([pauseWords(0), pauseWords(1), pauseWords(2)]).toStrictEqual([
      null,
      "May pause in 1 place",
      "May pause in 2 places",
    ]);
    expect(inputWarnings(check)).toHaveLength(1);
  });
});

describe(callersWords, () => {
  const roles = [
    { key: "admin", label: "Admin", workflows: "*" as const },
    { key: "manager", label: "Manager", workflows: ["deal_move_stage"] },
    { key: "sales", label: "Sales", workflows: ["deal_create"] },
  ];

  it("names the roles that may call it, or says why nothing can", () => {
    expect({
      called: callersWords({
        starts: "called",
        roles,
        workflow: "deal_move_stage",
      }),
      nobody: callersWords({ starts: "called", roles: [], workflow: "x" }),
      hidden: callersWords({
        starts: "called",
        roles: undefined,
        workflow: "x",
      }),
      event: callersWords({
        starts: { event: "deal_updated" },
        roles,
        workflow: "x",
      }),
      schedule: callersWords({
        starts: { schedule: "0 9 * * *" },
        roles,
        workflow: "x",
      }),
    }).toStrictEqual({
      called: "People with the Admin or Manager roles can call it.",
      nobody: "No role names it, so nobody can call it.",
      hidden: "People whose roles name it can call it.",
      event: "Nothing can call it: an event starts it.",
      schedule: "Nothing can call it: a schedule starts it.",
    });
  });
});
