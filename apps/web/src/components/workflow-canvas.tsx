// The steps as a flowchart: a node per step, a labelled line per path, laid
// out from the tree each time (decision 0059). Nothing can be moved here
// yet; selecting a node selects the step, as a row in the outline does.
import "@xyflow/react/dist/style.css";
import { Button } from "@workspace/ui/components/button";
import {
  Background,
  BaseEdge,
  EdgeLabelRenderer,
  Handle,
  MarkerType,
  Panel,
  Position,
  ReactFlow,
  getSmoothStepPath,
  useReactFlow,
} from "@xyflow/react";
import type {
  Edge,
  EdgeProps,
  Node,
  NodeProps,
  ReactFlowInstance,
} from "@xyflow/react";
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
import { useMemo, useState } from "react";

import { workflowLayout } from "../lib/workflow-layout.ts";
import type {
  Layout,
  LayoutEdge,
  LayoutNode,
  LayoutSlot,
} from "../lib/workflow-layout.ts";
import { countWords, findingsByRow } from "../lib/workflow-problems.ts";
import type { Finding } from "../lib/workflow-problems.ts";
import type { Cut } from "../lib/workflow-segments.ts";
import { slotOf } from "../lib/workflow-steps.ts";
import type { Slot } from "../lib/workflow-steps.ts";
import {
  insidePath,
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
  /** The step is inside the path that is open beside the canvas. */
  inPath: boolean;
  /** Open a path with no steps, from its marker. */
  onPath: (path: string) => void;
  /** In edit mode, a path with no steps is where its first step is added. */
  onAdd: (() => void) | null;
  /** A step is being dragged and would land here. */
  near: boolean;
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
      } ${data.inPath ? "border-foreground" : ""}`}
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
  if (node.kind === "empty" && data.onAdd) {
    const { onAdd } = data;
    return (
      <button
        type="button"
        aria-pressed={data.pressed}
        aria-label="A path with no steps. Add a step here."
        onClick={() => onAdd()}
        className={`nopan flex size-full cursor-pointer items-center justify-center gap-1.5 rounded-full border border-dashed px-3 text-xs focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none ${
          data.near || data.pressed
            ? "border-foreground bg-muted"
            : "bg-background hover:bg-muted/60"
        }`}
      >
        <Plus aria-hidden className="size-3.5 shrink-0" />
        Add a step
      </button>
    );
  }
  if (node.kind === "empty") {
    return (
      <button
        type="button"
        aria-pressed={data.pressed}
        aria-label="A path with no steps. Open it."
        onClick={() => data.onPath(node.id)}
        className={`nopan flex size-full cursor-pointer items-center justify-center gap-1.5 rounded-full border border-dashed px-3 text-xs focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none ${
          data.pressed
            ? "border-foreground bg-muted"
            : "text-muted-foreground hover:bg-muted/60"
        }`}
      >
        <Icon aria-hidden className="size-3.5 shrink-0" />
        {data.text}
      </button>
    );
  }
  return (
    <span
      title={data.text}
      className="flex size-full items-center justify-center gap-1.5 rounded-full border bg-muted px-3 text-xs font-medium"
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

interface SlotData extends Record<string, unknown> {
  /** "Add a step to Steps, at place 2": what a screen reader hears. */
  name: string;
  pressed: boolean;
  near: boolean;
  onAdd: () => void;
}

type SlotNode = Node<SlotData, "slot">;
type AnyNode = ChartNode | SlotNode;

const slotSize = 22;

/** A place a step can go: press it to add one, or drop a step on it. */
const SlotNodeView = ({ data }: NodeProps<SlotNode>) => (
  <button
    type="button"
    aria-label={data.name}
    aria-pressed={data.pressed}
    onClick={() => data.onAdd()}
    className={`nopan flex size-full cursor-pointer items-center justify-center rounded-full border focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none ${
      data.near || data.pressed
        ? "scale-125 border-foreground bg-foreground text-background"
        : "bg-background text-muted-foreground hover:bg-muted"
    }`}
  >
    <Plus aria-hidden className="size-3" />
  </button>
);

const nodeTypes = { chart: ChartNodeView, slot: SlotNodeView };

const lineColour = "var(--muted-foreground)";

interface PathData extends Record<string, unknown> {
  label: string;
  /** "Then, the path from Check reason": what a screen reader hears. */
  name: string;
  pressed: boolean;
  onOpen: () => void;
}

type PathEdge = Edge<PathData, "path">;

/** A line into a path, whose label opens that path beside the canvas. */
const PathEdgeView = (props: EdgeProps<PathEdge>) => {
  const [line, x, y] = getSmoothStepPath(props);
  const { data } = props;
  return (
    <>
      <BaseEdge
        id={props.id}
        path={line}
        style={props.style}
        {...(props.markerEnd ? { markerEnd: props.markerEnd } : {})}
      />
      {data ? (
        <EdgeLabelRenderer>
          <button
            type="button"
            aria-pressed={data.pressed}
            aria-label={data.name}
            onClick={() => data.onOpen()}
            style={{
              transform: `translate(-50%, -50%) translate(${x}px, ${y}px)`,
            }}
            className={`nodrag nopan pointer-events-auto absolute cursor-pointer rounded-md border px-1.5 text-xs/5 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none ${
              data.pressed
                ? "border-foreground bg-foreground text-background"
                : "bg-background hover:bg-muted"
            }`}
          >
            {data.label}
          </button>
        </EdgeLabelRenderer>
      ) : null}
    </>
  );
};

const edgeTypes = { path: PathEdgeView };

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
  /** The path open beside the canvas, such as `steps.1.then`. */
  path: string | undefined;
  onPath: (path: string | undefined) => void;
  /** What starts the workflow, and what it gives back, in words. */
  startText: string;
  endText: string;
  /** Edit mode: where a step is being added, and what a press or drop does. */
  edit?:
    | {
        adding: Slot | null;
        onAdd: (slot: Slot) => void;
        onDrop: (path: string, slot: Slot) => void;
      }
    | undefined;
}

interface Drag {
  id: string;
  x: number;
  y: number;
}

/** How close, in canvas units, a dragged step must be to a slot to land on it. */
const reach = 110;

/** The slot a dragged step would land on, or null. Never one inside itself. */
const nearestSlot = (layout: Layout, drag: Drag | null): LayoutSlot | null => {
  const node = layout.nodes.find((each) => each.id === drag?.id);
  if (!drag || !node) {
    return null;
  }
  const own = slotOf(drag.id);
  const x = drag.x + node.width / 2;
  const y = drag.y + node.height / 2;
  let best: LayoutSlot | null = null;
  let bestDistance = reach;
  for (const slot of layout.slots) {
    const inside = slot.list === drag.id || slot.list.startsWith(`${drag.id}.`);
    // The slots on either side of the step would leave it where it is.
    const beside =
      slot.list === own.list &&
      (slot.index === own.index || slot.index === own.index + 1);
    const distance = Math.hypot(slot.x - x, slot.y - y);
    if (!inside && !beside && distance < bestDistance) {
      best = slot;
      bestDistance = distance;
    }
  }
  return best;
};

const sameSlot = (a: Slot | null | undefined, b: Slot) =>
  a !== null && a !== undefined && a.list === b.list && a.index === b.index;

/** The plus between steps. A path with no steps uses its marker instead. */
const slotNodes = (
  layout: Layout,
  edit: NonNullable<WorkflowCanvasProps["edit"]>,
  near: LayoutSlot | null
): SlotNode[] => {
  const empty = new Set(
    layout.nodes.flatMap((node) => (node.kind === "empty" ? [node.id] : []))
  );
  return layout.slots
    .filter((slot) => !empty.has(slot.list) && !empty.has(`${slot.list}.empty`))
    .map((slot) => ({
      id: `slot:${slot.id}`,
      type: "slot",
      position: { x: slot.x - slotSize / 2, y: slot.y - slotSize / 2 },
      width: slotSize,
      height: slotSize,
      draggable: false,
      connectable: false,
      selectable: false,
      focusable: false,
      zIndex: 5,
      data: {
        name: `Add a step at place ${slot.index + 1} of ${slot.list}`,
        pressed: sameSlot(edit.adding, slot),
        near: near?.id === slot.id,
        onAdd: () => edit.onAdd({ list: slot.list, index: slot.index }),
      },
    }));
};

const markerText = (node: LayoutNode, props: WorkflowCanvasProps) => {
  if (node.kind === "start") {
    return props.startText;
  }
  if (node.kind === "end") {
    return props.endText;
  }
  return node.kind === "empty" ? "Nothing" : "";
};

const useChart = (props: WorkflowCanvasProps, drag: Drag | null) => {
  const { tree, selected, onSelect, findings, cuts, queued, edit } = props;
  const layout = useMemo(() => workflowLayout(tree), [tree]);
  const byRow = findingsByRow(findings);
  const near = nearestSlot(layout, drag);
  const emptySlot = (node: LayoutNode) =>
    layout.slots.find(
      (slot) => slot.list === node.id || `${slot.list}.empty` === node.id
    );
  const chart = layout.nodes.map((node): ChartNode => {
    const id = node.kind === "step" ? (node.row.id ?? "") : "";
    const slot = node.kind === "empty" ? emptySlot(node) : undefined;
    const dragged = drag?.id === node.id;
    return {
      id: node.id,
      type: "chart",
      position: dragged ? { x: drag.x, y: drag.y } : { x: node.x, y: node.y },
      width: node.width,
      height: node.height,
      zIndex: dragged ? 10 : 0,
      draggable: edit !== undefined && node.kind === "step",
      connectable: false,
      selectable: false,
      focusable: false,
      data: {
        node,
        text: markerText(node, props),
        pressed:
          node.kind === "empty"
            ? props.path === node.id ||
              (slot !== undefined && sameSlot(edit?.adding, slot))
            : selected !== undefined && selected.path === node.id,
        onAdd:
          edit && slot
            ? () => edit.onAdd({ list: slot.list, index: slot.index })
            : null,
        near: slot !== undefined && near?.id === slot.id,
        inPath: node.kind === "step" && insidePath(node.row, props.path),
        onPath: (path) => props.onPath(props.path === path ? undefined : path),
        found: countWords(byRow.get(node.id) ?? []),
        cut: cuts.get(id),
        queued: queued.has(id),
        onSelect: (row) =>
          onSelect(row.path === selected?.path ? undefined : row.address),
      },
    };
  });
  const titles = new Map(
    layout.nodes.flatMap((node): [string, string][] =>
      node.kind === "step" ? [[node.id, rowTitle(node.row)]] : []
    )
  );
  const edges = layout.edges.map((edge): Edge => {
    const { label, opens } = edge;
    return label === null || opens === null
      ? edgeOf(edge)
      : {
          ...edgeOf(edge),
          type: "path",
          data: {
            label,
            name: `${label}, the path from ${titles.get(edge.from) ?? "the step"}. Open it.`,
            pressed: props.path === opens,
            onOpen: () =>
              props.onPath(props.path === opens ? undefined : opens),
          } satisfies PathData,
        };
  });
  const nodes: AnyNode[] = [
    ...chart,
    ...(edit ? slotNodes(layout, edit, near) : []),
  ];
  return { layout, nodes, edges, near };
};

export const WorkflowCanvas = (props: WorkflowCanvasProps) => {
  const [drag, setDrag] = useState<Drag | null>(null);
  const { layout, nodes, edges, near } = useChart(props, drag);
  const { selected, edit } = props;
  // A link to a step opens with that step in the middle, at full size.
  const showSelected = (flow: ReactFlowInstance<AnyNode>) => {
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
        edgeTypes={edgeTypes}
        fitView
        fitViewOptions={{ maxZoom: 1, padding: 0.08 }}
        minZoom={0.3}
        maxZoom={1.5}
        panOnScroll
        nodesDraggable={edit !== undefined}
        nodeDragThreshold={4}
        onNodeDrag={(_event, node) =>
          setDrag({ id: node.id, x: node.position.x, y: node.position.y })
        }
        onNodeDragStop={(_event, node) => {
          setDrag(null);
          if (edit && near) {
            edit.onDrop(node.id, { list: near.list, index: near.index });
          }
        }}
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
