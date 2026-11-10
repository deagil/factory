// The check's problems and warnings, each put on the step and the field
// its path points at.
import type { WorkflowCheck, WorkflowProblem } from "@workspace/workflows";

import { allRows } from "./workflow-tree.ts";
import type { TreeGroup, TreeRow, WorkflowTree } from "./workflow-tree.ts";

export interface Finding {
  kind: "problem" | "warning";
  message: string;
  /** The step it is on, or null for one about the workflow itself. */
  row: TreeRow | null;
  /** What in the step or the workflow it points at, such as `with.stage`. */
  field: string | null;
}

const under = (path: string, prefix: string) =>
  path === prefix || path.startsWith(`${prefix}.`);

/** The deepest step whose path the problem's path starts with. */
const rowAt = (rows: readonly TreeRow[], path: string) =>
  rows
    .filter((row) => under(path, row.path))
    .toSorted((a, b) => b.path.length - a.path.length)[0] ?? null;

const place = (
  rows: readonly TreeRow[],
  kind: Finding["kind"],
  problem: WorkflowProblem
): Finding => {
  const path = problem.path.join(".");
  const row = rowAt(rows, path);
  const rest = row ? path.slice(row.path.length + 1) : path;
  return {
    kind,
    message: problem.message,
    row,
    field: rest === "" ? null : rest,
  };
};

/** Every problem, then every warning, each on its step. */
export const findingsOf = (
  tree: WorkflowTree,
  check: WorkflowCheck | undefined
): Finding[] => {
  const rows = allRows(tree);
  return [
    ...(check?.problems ?? []).map((each) => place(rows, "problem", each)),
    ...(check?.warnings ?? []).map((each) => place(rows, "warning", each)),
  ];
};

/** The findings on each step, by the step's path. */
export const findingsByRow = (
  findings: readonly Finding[]
): Map<string, Finding[]> => {
  const byRow = new Map<string, Finding[]>();
  for (const finding of findings) {
    if (finding.row) {
      const { path } = finding.row;
      byRow.set(path, [...(byRow.get(path) ?? []), finding]);
    }
  }
  return byRow;
};

const counted = (count: number, word: string) =>
  count === 0 ? [] : [`${count} ${word}${count === 1 ? "" : "s"}`];

/** "2 problems, 1 warning", or null when there are none. */
export const countWords = (findings: readonly Finding[]): string | null => {
  const problems = findings.filter((each) => each.kind === "problem").length;
  const words = [
    ...counted(problems, "problem"),
    ...counted(findings.length - problems, "warning"),
  ];
  return words.length > 0 ? words.join(", ") : null;
};

/** The findings on the steps inside a branch, for when it is collapsed. */
export const findingsUnder = (
  group: TreeGroup,
  findings: readonly Finding[]
): Finding[] =>
  findings.filter((finding) =>
    finding.row ? under(finding.row.path, group.path) : false
  );
