import type { WorkflowDefinition } from "@workspace/workflows";
import { describe, expect, it } from "vitest";

import { overlapping, workflowLayout } from "./workflow-layout.ts";
import { workflowTree } from "./workflow-tree.ts";

const nested: WorkflowDefinition = {
  key: "deal_discount",
  description: "Approve a discount.",
  starts_when: "called",
  on_failure: [{ id: "tell", action: "task_create" }],
  attention_role: "manager",
  steps: [
    { id: "load", action: "deal_get" },
    {
      id: "big",
      if: [{ field: "input.amount", above: 10_000 }],
      // oxlint-disable-next-line unicorn/no-thenable -- a step's branch, not a promise
      then: [
        {
          id: "huge",
          if: [{ field: "input.amount", above: 50_000 }],
          // oxlint-disable-next-line unicorn/no-thenable -- a step's branch, not a promise
          then: [{ fail: "too_much" }],
          else: [{ id: "pause", wait: { for: "1d" } }],
        },
      ],
    },
    {
      id: "update",
      action: "deal_update",
      on_failure: [{ id: "undo", action: "deal_update" }],
    },
  ],
};

const layout = workflowLayout(workflowTree(nested));
const at = (id: string) => {
  const node = layout.nodes.find((each) => each.id === id);
  if (!node) {
    throw new Error(`No node ${id}`);
  }
  return node;
};
const centre = (id: string) => at(id).x + at(id).width / 2;
const into = (id: string) =>
  layout.edges.filter((edge) => edge.to === id).map((edge) => edge.from);

describe("the layout of a workflow", () => {
  it("runs the steps down one line, from the start to the end", () => {
    expect(centre("steps.0")).toBe(centre("start"));
    expect(centre("steps.2")).toBe(centre("end"));
    expect(at("steps.0").y).toBeGreaterThan(at("start").y);
    expect(at("end").y).toBeGreaterThan(at("steps.2").y);
    expect(into("steps.0")).toStrictEqual(["start"]);
  });

  it("puts a condition's paths side by side, and joins them below", () => {
    expect(at("steps.1.then.0").y).toBe(at("steps.1.else").y);
    expect(at("steps.1.then.0").x).toBeLessThan(at("steps.1.else").x);
    expect(at("steps.1.else").kind).toBe("empty");
    expect(into("steps.2")).toStrictEqual([
      "steps.1.then.0.else.0",
      "steps.1.else",
    ]);
    expect(layout.edges.find((edge) => edge.to === "steps.1.else")?.label).toBe(
      "Otherwise"
    );
  });

  it("draws no line on from a step that ends the run", () => {
    expect(
      layout.edges.filter((edge) => edge.from === "steps.1.then.0.then.0")
    ).toStrictEqual([]);
  });

  it("puts failure steps beside their step, and the workflow's own apart", () => {
    const side = layout.edges.find(
      (edge) => edge.to === "steps.2.on_failure.0"
    );
    expect(side).toMatchObject({ label: "If it fails", side: true });
    expect(at("steps.2.on_failure.0").y).toBe(at("steps.2").y);
    expect(at("on_failure").x).toBeGreaterThan(at("steps.2.on_failure.0").x);
    expect(into("on_failure.0")).toStrictEqual(["on_failure"]);
  });

  it("never puts two nodes in the same place, and is the same each time", () => {
    expect(overlapping(layout)).toStrictEqual([]);
    expect(workflowLayout(workflowTree(nested))).toStrictEqual(layout);
    expect(Math.max(...layout.nodes.map((node) => node.x + node.width))).toBe(
      layout.width
    );
  });
});
