import { describe, expect, it } from "vitest";

import { describeChange } from "./config-diff.ts";

const stages = (options: object[]) => ({ key: "deal_stages", options });

const option = (key: string) => ({ key, label: key });

const changed = (beforeValue: unknown, afterValue: unknown) =>
  describeChange({
    path: "config/choices/x.yaml",
    type: "choices",
    key: "x",
    beforeValue,
    afterValue,
  });

describe(describeChange, () => {
  it("names each option a choice list adds, renames, archives or moves", () => {
    const change = describeChange({
      path: "config/choices/deal_stages.yaml",
      type: "choices",
      key: "deal_stages",
      beforeValue: stages([
        { key: "lead", label: "Lead", category: "open" },
        { key: "won", label: "Won", category: "won" },
        { key: "lost", label: "Lost", category: "lost" },
      ]),
      afterValue: stages([
        { key: "lead", label: "New lead", category: "open" },
        { key: "won", label: "Won", category: "won", archived: true },
        {
          key: "nego",
          label: "Negotiation",
          description: "Agreeing terms",
          category: "open",
        },
      ]),
    });
    expect(change).toStrictEqual({
      path: "config/choices/deal_stages.yaml",
      title: "Choice list deal_stages",
      kind: "changed",
      lines: [
        "Renames the option lead from “Lead” to “New lead”.",
        "Archives the option “Won”.",
        "Adds the option “Negotiation” (nego), “Agreeing terms”; category open.",
        "Removes the option “Lost”.",
      ],
    });
  });

  it("says what a role gains and loses", () => {
    const change = describeChange({
      path: "config/roles/sales.yaml",
      type: "roles",
      key: "sales",
      beforeValue: {
        key: "sales",
        label: "Sales",
        objects: {
          deal: { endpoints: ["list", "get", "update"], rows: "all" },
        },
        workflows: ["deal_create"],
      },
      afterValue: {
        key: "sales",
        label: "Sales team",
        objects: {
          deal: {
            endpoints: ["list", "get", "archive"],
            rows: "own",
            write: { except: ["stage"] },
          },
        },
        workflows: ["deal.moveStage"],
      },
    });
    expect(change.lines).toStrictEqual([
      "Changes label from Sales to Sales team.",
      "Can now archive deal.",
      "Can no longer update deal.",
      "Now reaches only its own deal records.",
      "Writes all but stage of deal, not every field.",
      "Can now call deal.moveStage.",
      "Can no longer call deal_create.",
    ]);
  });

  it("notices a reorder, a new file, a deleted one and a layout-only edit", () => {
    expect([
      changed(
        stages([option("a"), option("b")]),
        stages([option("b"), option("a")])
      ).lines,
      changed(null, { key: "x", options: [] }).kind,
      changed({ key: "x" }, null).lines,
      changed({ key: "x" }, { key: "x" }).lines,
    ]).toStrictEqual([
      ["Puts the options in this order: “b”, “a”."],
      "added",
      ["Deletes the file."],
      ["Changes only its layout or comments, not what it says."],
    ]);
  });
});
