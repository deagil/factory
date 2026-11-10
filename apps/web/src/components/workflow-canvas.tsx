// The steps as a flowchart: a node per step, a labelled line per path, laid
// out from the tree each time (decision 0059). Nothing can be moved here
// yet; selecting a node selects the step, as a row in the outline does.
import "@xyflow/react/dist/style.css";
import { Button } from "@workspace/ui/components/button";
import {
  Background,
  Handle,
  MarkerType,
  Panel,
  Position,
  ReactFlow,
  useReactFlow,
} from "@xyflow/react";
import type { Edge, Node, NodeProps, ReactFlowInstance } from "@xyflow/react";
import {
  CircleAlert,
  CircleDashed,
  Flag,
  Maximize,
  Minus,
  Play,
  Plus,
  Scissors,
  Send,
} from "lucide-react";
import { useMemo } from "react";

import { workflowLayout } from "../lib/workflow-layout.ts";
import type { LayoutEdge, LayoutNode } from "../lib/workflow-layout.ts";
import { countWords, findingsByRow } from "../lib/workflow-problems.ts";
import type { Finding } from "../lib/workflow-problems.ts";
import type { Cut } from "../lib/workflow-segments.ts";
import {
  kindWords,
  rowName,
  rowTitle,
  stepWords,
} from "../lib/workflow-tree.ts";
import type { TreeRow, WorkflowTree } from "../lib/workflow-tree.ts";
import { stepIcons } from "./workflow-outline.tsx";

interface ChartData extends Record<string, unknown> {
  node: LayoutNode;
  /** The words on a start or end marker. */
  text: string;
  pressed: boolean;
  /** "1 problem, 2 warnings", or null. */
  found: string | null;
  cut: Cut | undefined;
  queued: boolean;
  onSelect: (row: TreeRow) => void;
}

type ChartNode = Node<ChartData, "chart">;

const hidden = "!size-px !min-h-0 !min-w-0 !border-0 !bg-transparent";

/** Where lines meet a node: in at the top, on at the bottom, failure at the side. */
const Handles = () => (
  <>
    <Handle
      type="target"
      id="in"
      position={Position.Top}
      isConnectable={false}
      className={hidden}
    />
    <Handle
      type="target"
      id="side-in"
      position={Position.Left}
      isConnectable={false}
      className={hidden}
    />
    <Handle
      type="source"
      id="out"
      position={Position.Bottom}
      isConnectable={false}
      className={hidden}
    />
    <Handle
      type="source"
      id="side"
      position={Position.Right}
      isConnectable={false}
      className={hidden}
    />
  </>
);

const CutMark = ({ cut }: { cut: Cut | undefined }) =>
  cut ? (
    <span
      title={cut.text}
      className="absolute -top-2.5 left-3 flex items-center gap-1 rounded-full border bg-background px-2 text-[11px]/4 font-medium"
    >
      <Scissors aria-hidden className="size-3" />
      Commits here
    </span>
  ) : null;

const StepNode = ({ row, data }: { row: TreeRow; data: ChartData }) => {
  const Icon = stepIcons[row.kind];
  return (
    <button
      type="button"
      aria-pressed={data.pressed}
      aria-label={[rowName(row), data.cut?.text, data.found]
        .filter((part) => part !== undefined && part !== null)
        .join(", ")}
      onClick={() => data.onSelect(row)}
      className={`nopan relative flex size-full cursor-pointer flex-col justify-center rounded-xl border px-3 text-left text-sm focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none ${
        data.pressed
          ? "border-foreground bg-muted"
          : "bg-background hover:bg-muted/60"
      }`}
    >
      <CutMark cut={data.cut} />
      <span className="flex min-w-0 items-center gap-2">
        <Icon aria-hidden className="size-4 shrink-0" />
        <span className="min-w-0 flex-1 truncate font-medium">
          {rowTitle(row)}
        </span>
        {data.queued ? (
          <span title="Sent after the commit, outside the transaction.">
            <Send aria-hidden className="size-3.5 shrink-0" />
          </span>
        ) : null}
        {data.found ? (
          <span title={data.found}>
            <CircleAlert aria-hidden className="size-4 shrink-0" />
          </span>
        ) : null}
        <span className="shrink-0 text-xs text-muted-foreground">
          {kindWords[row.kind]}
        </span>
      </span>
      <span className="line-clamp-2 text-xs text-muted-foreground">
        {stepWords(row.step)}
      </span>
    </button>
  );
};

const markerIcons = { start: Play, end: Flag, empty: CircleDashed } as const;

const Marker = ({ data }: { data: ChartData }) => {
  const { node } = data;
  if (node.kind === "step") {
    return null;
  }
  if (node.kind === "label") {
    return (
      <span className="flex size-full items-center text-xs/4 font-medium">
        {node.text}
      </span>
    );
  }
  const Icon = markerIcons[node.kind];
  return (
    <span
      title={data.text}
      className={`flex size-full items-center justify-center gap-1.5 rounded-full border px-3 text-xs ${
        node.kind === "empty"
          ? "border-dashed text-muted-foreground"
          : "bg-muted font-medium"
      }`}
    >
      <Icon aria-hidden className="size-3.5 shrink-0" />
      <span className="truncate">{data.text}</span>
    </span>
  );
};

const ChartNodeView = ({ data }: NodeProps<ChartNode>) => (
  <>
    <Handles />
    {data.node.kind === "step" ? (
      <StepNode row={data.node.row} data={data} />
    ) : (
      <Marker data={data} />
    )}
  </>
);

const nodeTypes = { chart: ChartNodeView };

const lineColour = "var(--muted-foreground)";

const edgeOf = (edge: LayoutEdge): Edge => ({
  id: edge.id,
  source: edge.from,
  target: edge.to,
  sourceHandle: edge.side ? "side" : "out",
  targetHandle: edge.side ? "side-in" : "in",
  type: "smoothstep",
  focusable: false,
  selectable: false,
  markerEnd: { type: MarkerType.ArrowClosed, color: lineColour },
  style: { stroke: lineColour },
  ...(edge.label
    ? {
        label: edge.label,
        labelStyle: { fill: "var(--foreground)", fontSize: 12 },
        labelBgStyle: { fill: "var(--background)" },
        labelBgPadding: [6, 3] as [number, number],
        labelBgBorderRadius: 6,
      }
    : {}),
});

const ZoomButtons = () => {
  const flow = useReactFlow();
  return (
    <Panel position="top-right" className="flex gap-1">
      <Button
        type="button"
        variant="outline"
        size="icon-sm"
        aria-label="Zoom out"
        onClick={() => {
          void flow.zoomOut();
        }}
      >
        <Minus aria-hidden />
      </Button>
      <Button
        type="button"
        variant="outline"
        size="icon-sm"
        aria-label="Zoom in"
        onClick={() => {
          void flow.zoomIn();
        }}
      >
        <Plus aria-hidden />
      </Button>
      <Button
        type="button"
        variant="outline"
        size="icon-sm"
        aria-label="Fit the whole workflow"
        onClick={() => {
          void flow.fitView({ maxZoom: 1 });
        }}
      >
        <Maximize aria-hidden />
      </Button>
    </Panel>
  );
};

export interface WorkflowCanvasProps {
  tree: WorkflowTree;
  /** The selected step's row, from the URL. */
  selected: TreeRow | undefined;
  onSelect: (address: string | undefined) => void;
  findings: readonly Finding[];
  /** By step id: the steps that end a segment, and those sent after one. */
  cuts: ReadonlyMap<string, Cut>;
  queued: ReadonlySet<string>;
  /** What starts the workflow, and what it gives back, in words. */
  startText: string;
  endText: string;
}

const markerText = (node: LayoutNode, props: WorkflowCanvasProps) => {
  if (node.kind === "start") {
    return props.startText;
  }
  if (node.kind === "end") {
    return props.endText;
  }
  return node.kind === "empty" ? "Nothing" : "";
};

const useChart = (props: WorkflowCanvasProps) => {
  const { tree, selected, onSelect, findings, cuts, queued } = props;
  const layout = useMemo(() => workflowLayout(tree), [tree]);
  const byRow = findingsByRow(findings);
  const nodes = layout.nodes.map((node): ChartNode => {
    const id = node.kind === "step" ? (node.row.id ?? "") : "";
    return {
      id: node.id,
      type: "chart",
      position: { x: node.x, y: node.y },
      width: node.width,
      height: node.height,
      draggable: false,
      connectable: false,
      selectable: false,
      focusable: false,
      data: {
        node,
        text: markerText(node, props),
        pressed: selected !== undefined && selected.path === node.id,
        found: countWords(byRow.get(node.id) ?? []),
        cut: cuts.get(id),
        queued: queued.has(id),
        onSelect: (row) =>
          onSelect(row.path === selected?.path ? undefined : row.address),
      },
    };
  });
  const edges = useMemo(() => layout.edges.map(edgeOf), [layout]);
  return { layout, nodes, edges };
};

export const WorkflowCanvas = (props: WorkflowCanvasProps) => {
  const { layout, nodes, edges } = useChart(props);
  const { selected } = props;
  // A link to a step opens with that step in the middle, at full size.
  const showSelected = (flow: ReactFlowInstance<ChartNode>) => {
    const node = layout.nodes.find((each) => each.id === selected?.path);
    if (node) {
      void flow.setCenter(node.x + node.width / 2, node.y + node.height / 2, {
        zoom: Math.max(flow.getZoom(), 0.85),
      });
    }
  };
  return (
    <section
      aria-label="Steps, as a flowchart"
      className="h-[34rem] overflow-hidden rounded-2xl border"
    >
      <ReactFlow
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        fitView
        fitViewOptions={{ maxZoom: 1, padding: 0.08 }}
        minZoom={0.3}
        maxZoom={1.5}
        panOnScroll
        nodesDraggable={false}
        nodesConnectable={false}
        nodesFocusable={false}
        edgesFocusable={false}
        elementsSelectable={false}
        onInit={showSelected}
        style={{ background: "transparent" }}
      >
        <Background color="var(--border)" gap={20} />
        <ZoomButtons />
      </ReactFlow>
    </section>
  );
};
