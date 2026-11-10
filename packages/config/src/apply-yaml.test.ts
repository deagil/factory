import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";
import { parse } from "yaml";

import { yamlWithValue } from "./apply-yaml.ts";

const crm = (file: string) =>
  readFileSync(
    path.resolve(import.meta.dirname, "../../../examples/crm/config", file),
    "utf-8"
  );

/** Lines that differ, as `line: before -> after`. */
const diffLines = (before: string, after: string): string[] => {
  const left = before.split("\n");
  const right = after.split("\n");
  const lines: string[] = [];
  const count = Math.max(left.length, right.length);
  for (let index = 0; index < count; index += 1) {
    if (left[index] !== right[index]) {
      lines.push(`${index + 1}: ${left[index] ?? ""} -> ${right[index] ?? ""}`);
    }
  }
  return lines;
};

describe(yamlWithValue, () => {
  it("returns the file unchanged when the value matches it", () => {
    const files = [
      "workflows/deal_move_stage.yaml",
      "choices/deal_stages.yaml",
      "roles/sales.yaml",
    ];
    expect(
      files.map((file) => {
        const content = crm(file);
        return (
          yamlWithValue(content, parse(content) as Record<string, unknown>) ===
          content
        );
      })
    ).toStrictEqual([true, true, true]);
  });

  it("changes one step's with and leaves the rest of the workflow file", () => {
    const content = crm("workflows/deal_move_stage.yaml");
    const value = parse(content) as {
      steps: { id?: string; with?: Record<string, unknown> }[];
    };
    const update = value.steps.find((step) => step.id === "update");
    if (!update?.with) {
      throw new Error("update step has no with");
    }
    update.with = {
      id: { from: "input.deal" },
      stage: { value: "won" },
    };
    const next = yamlWithValue(content, value);
    expect(diffLines(content, next)).toStrictEqual([
      "34:       stage: { from: input.stage } ->       stage: { value: won }",
    ]);
    expect(next.startsWith("# Moving a deal's stage")).toBeTruthy();
    expect(next).toContain("Roles get no write on stage");
    expect(next).toContain("id: announce");
  });

  it("keeps a choice list's comments and the options it didn't change", () => {
    const content = crm("choices/deal_stages.yaml");
    const value = parse(content) as {
      options: { key: string; label: string }[];
    };
    const lead = value.options.find((option) => option.key === "lead");
    if (!lead) {
      throw new Error("no lead option");
    }
    lead.label = "New lead";
    const next = yamlWithValue(content, value);
    expect(diffLines(content, next)).toStrictEqual([
      "7:     label: Lead ->     label: New lead",
    ]);
    expect(next.startsWith("# deal.stage.")).toBeTruthy();
    expect(next).toContain("key: won");
  });

  it("keeps a role's comments and the flow style it didn't change", () => {
    const content = crm("roles/sales.yaml");
    const value = parse(content) as { label: string };
    value.label = "Sales team";
    const next = yamlWithValue(content, value);
    expect(diffLines(content, next)).toStrictEqual([
      "4: label: Sales -> label: Sales team",
    ]);
    expect(next.startsWith("# Sales: their own deals")).toBeTruthy();
    expect(next).toContain(
      "write: { except: [organisation] } # contact.moveToOrganisation moves it"
    );
    expect(next).toContain("rows: own # the deal's owner is them");
    expect(next).toContain("endpoints: [list, get, create, update, history]");
  });

  it("matches list items by id when one moves, and keeps its text", () => {
    const content = [
      "# steps",
      "steps:",
      "  - id: load",
      "    action: deal_get",
      "  - id: update",
      "    action: deal_update # the write",
      "    with: { stage: { from: input.stage } }",
      "",
    ].join("\n");
    const value = parse(content) as { steps: { id: string }[] };
    const [load, update] = value.steps;
    if (!load || !update) {
      throw new Error("expected two steps");
    }
    value.steps = [update, load];
    const next = yamlWithValue(content, value);
    expect(next.startsWith("# steps\n")).toBeTruthy();
    expect(next).toContain("action: deal_update # the write");
    expect(next).toContain("with: { stage: { from: input.stage } }");
    expect(next.indexOf("id: update")).toBeLessThan(next.indexOf("id: load"));
  });

  it("appends a new option without rewriting the ones already there", () => {
    const content = crm("choices/deal_stages.yaml");
    const value = parse(content) as {
      options: { key: string; label: string; category: string }[];
    };
    value.options.push({
      key: "closing",
      label: "Closing",
      category: "open",
    });
    const next = yamlWithValue(content, value);
    expect(next.startsWith("# deal.stage.")).toBeTruthy();
    expect(next).toContain(
      "description: The buyer said no, or went quiet; needs a reason"
    );
    expect(next).toContain("key: closing");
    const changed = diffLines(content, next);
    expect(
      changed.every((line) => Number(line.split(":")[0]) > 20)
    ).toBeTruthy();
  });

  it("writes fresh YAML when the file doesn't parse", () => {
    const next = yamlWithValue("key: [", { key: "sales", label: "Sales" });
    expect(parse(next)).toStrictEqual({ key: "sales", label: "Sales" });
  });
});
