// Where each step sits on the canvas, worked out from the tree alone. Steps
// run down the page, a condition's paths sit side by side and join below it,
// and failure steps sit beside their step. Nothing here is stored: the same
// tree always gives the same layout.
import type { TreeGroup, TreeRow, WorkflowTree } from "./workflow-tree.ts";

export const nodeWidth = 260;
export const nodeHeight = 72;
export const markerWidth = 180;
export const markerHeight = 36;
const down = 44;
const across = 48;

interface Box {
  x: number;
  y: number;
  width: number;
  height: number;
}

export type LayoutNode = Box &
  (
    | { kind: "start" | "end"; id: string }
    | { kind: "step"; id: string; row: TreeRow }
    /** A path with no steps: where one would go. */
    | { kind: "empty"; id: string }
    /** The heading of the workflow's own failure steps. */
    | { kind: "label"; id: string; text: string }
  );

export interface LayoutEdge {
  id: string;
  from: string;
  to: string;
  /** "Then", "Otherwise" or "If it fails" on the line out of a step. */
  label: string | null;
  /** A line out of the side of a step, to its failure steps. */
  side: boolean;
}

export interface Layout {
  nodes: LayoutNode[];
  edges: LayoutEdge[];
  width: number;
  height: number;
}

interface Block {
  nodes: LayoutNode[];
  edges: LayoutEdge[];
  width: number;
  height: number;
  /** How far the block's main line is from its left edge. */
  axis: number;
  /** The node a line into the block arrives at. */
  entry: string;
  /** The nodes a line leaves the block from. None when every path ends. */
  exits: string[];
}

const edge = (
  from: string,
  to: string,
  label: string | null = null,
  side = false
): LayoutEdge => ({ id: `${from}>${to}`, from, to, label, side });

const moved = (block: Block, x: number, y: number): LayoutNode[] =>
  block.nodes.map((node) => ({ ...node, x: node.x + x, y: node.y + y }));

const marker = (
  node: { kind: "start" | "end" | "empty"; id: string } | LabelNode
): Block => ({
  nodes: [{ ...node, x: 0, y: 0, width: markerWidth, height: markerHeight }],
  edges: [],
  width: markerWidth,
  height: markerHeight,
  axis: markerWidth / 2,
  entry: node.id,
  exits: [node.id],
});

interface LabelNode {
  kind: "label";
  id: string;
  text: string;
}

/** Blocks one under the other on one line, each joined to the next. */
const stack = (blocks: readonly Block[], fallback: Block): Block => {
  const [first] = blocks;
  if (!first) {
    return fallback;
  }
  const axis = Math.max(...blocks.map((block) => block.axis));
  const result: Block = {
    nodes: [],
    edges: [],
    width: axis + Math.max(...blocks.map((block) => block.width - block.axis)),
    height: 0,
    axis,
    entry: first.entry,
    exits: [],
  };
  for (const [index, block] of blocks.entries()) {
    const top = index === 0 ? 0 : result.height + down;
    result.nodes.push(...moved(block, axis - block.axis, top));
    result.edges.push(
      ...result.exits.map((from) => edge(from, block.entry)),
      ...block.edges
    );
    result.exits = block.exits;
    result.height = top + block.height;
  }
  return result;
};

const pathBlock = (rows: readonly TreeRow[], id: string): Block =>
  // oxlint-disable-next-line no-use-before-define -- a path holds steps, and a step holds paths
  stack(rows.map(rowBlock), marker({ kind: "empty", id }));

const groupOf = (row: TreeRow, kind: TreeGroup["kind"]) =>
  row.groups.find((group) => group.kind === kind);

/** The two paths of a condition, side by side under it. */
const lanesOf = (row: TreeRow) => {
  if (row.kind !== "if") {
    return null;
  }
  const lanes = (["then", "else"] as const).map((kind) => {
    const group = groupOf(row, kind);
    return {
      label: kind === "then" ? "Then" : "Otherwise",
      block: pathBlock(group?.rows ?? [], `${row.path}.${kind}`),
    };
  });
  const [first, second] = lanes;
  return first && second ? { first, second } : null;
};

const rowBlock = (row: TreeRow): Block => {
  const lanes = lanesOf(row);
  const failure = groupOf(row, "on_failure");
  const side = failure ? pathBlock(failure.rows, failure.path) : null;
  const lanesWidth = lanes
    ? lanes.first.block.width + across + lanes.second.block.width
    : 0;
  const axis = lanes
    ? Math.max(lanes.first.block.width + across / 2, nodeWidth / 2)
    : nodeWidth / 2;
  const sideLeft = axis + nodeWidth / 2 + across;
  const top = Math.max(nodeHeight, side?.height ?? 0);
  const block: Block = {
    nodes: [
      {
        kind: "step",
        id: row.path,
        row,
        x: axis - nodeWidth / 2,
        y: 0,
        width: nodeWidth,
        height: nodeHeight,
      },
    ],
    edges: [],
    width: Math.max(
      axis + nodeWidth / 2,
      lanesWidth,
      side ? sideLeft + side.width : 0
    ),
    height: top,
    axis,
    entry: row.path,
    exits: row.ends ? [] : [row.path],
  };
  if (side) {
    block.nodes.push(...moved(side, sideLeft, 0));
    block.edges.push(
      edge(row.path, side.entry, "If it fails", true),
      ...side.edges
    );
  }
  if (lanes) {
    const lanesTop = top + down;
    const { first, second } = lanes;
    block.nodes.push(
      ...moved(first.block, 0, lanesTop),
      ...moved(second.block, first.block.width + across, lanesTop)
    );
    block.edges.push(
      edge(row.path, first.block.entry, first.label),
      ...first.block.edges,
      edge(row.path, second.block.entry, second.label),
      ...second.block.edges
    );
    block.exits = [...first.block.exits, ...second.block.exits];
    block.height = lanesTop + Math.max(first.block.height, second.block.height);
  }
  return block;
};

/** The workflow's own failure steps, under their heading. */
const ownFailure = (group: TreeGroup): Block =>
  stack(
    [
      marker({ kind: "label", id: group.path, text: group.label }),
      ...group.rows.map(rowBlock),
    ],
    marker({ kind: "empty", id: `${group.path}.empty` })
  );

export const workflowLayout = (tree: WorkflowTree): Layout => {
  const steps = stack(
    tree.rows.map(rowBlock),
    marker({ kind: "empty", id: "steps" })
  );
  const main = stack(
    [
      marker({ kind: "start", id: "start" }),
      steps,
      ...(steps.exits.length > 0 ? [marker({ kind: "end", id: "end" })] : []),
    ],
    steps
  );
  const failure = tree.onFailure ? ownFailure(tree.onFailure) : null;
  const failureLeft = main.width + across * 2;
  return {
    nodes: [...main.nodes, ...(failure ? moved(failure, failureLeft, 0) : [])],
    edges: [...main.edges, ...(failure?.edges ?? [])],
    width: failure ? failureLeft + failure.width : main.width,
    height: Math.max(main.height, failure?.height ?? 0),
  };
};

/** Two nodes share space: a layout that does this is wrong. */
export const overlapping = (layout: Layout): [string, string][] =>
  layout.nodes.flatMap((a, index) =>
    layout.nodes
      .slice(index + 1)
      .filter(
        (b) =>
          a.x < b.x + b.width &&
          b.x < a.x + a.width &&
          a.y < b.y + b.height &&
          b.y < a.y + a.height
      )
      .map((b): [string, string] => [a.id, b.id])
  );
