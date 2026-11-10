import { organisation } from "@workspace/objects/testing";
import { defineWorkflow } from "@workspace/workflows";
import { describe, expect, it } from "vitest";

import { defineSystem } from "./system.ts";

const archive = (action: string) =>
  defineWorkflow({
    key: "organisation_tidy",
    description: "Archive an organisation.",
    starts_when: "called",
    input: { organisation: { type: "ref", object: "organisation" } },
    steps: [
      {
        id: "archive",
        action,
        with: { id: { from: "input.organisation" } },
      },
    ],
  });

describe("workflows in code (P2.16)", () => {
  it("lists them with their segments, and refuses one that doesn't line up", () => {
    const system = defineSystem({
      name: "s",
      objects: [organisation],
      workflows: [archive("organisation_archive")],
    });
    const described = system.describe().workflows;
    expect(described.map((workflow) => workflow.key)).toStrictEqual([
      "workflow_list",
      "workflow_get",
      "organisation_tidy",
    ]);
    expect(
      described.find((workflow) => workflow.key === "organisation_tidy")
    ).toMatchObject({
      source: "code",
      problems: [],
      segments: [{ steps: ["archive"], ends: null }],
    });
    expect(() =>
      defineSystem({
        name: "s",
        objects: [organisation],
        workflows: [archive("organisation_vanish")],
      })
    ).toThrow(
      'steps.0.action: There is no action "organisation_vanish". fx describe lists the step actions.'
    );
  });
});
