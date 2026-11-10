// The outline: one row per step in file order, with branches and failure
// steps nested under the step that owns them, and the selected step's
// detail beside it when the pane is wide and under its row when it isn't.
import {
  ChevronDown,
  ChevronRight,
  Clock,
  CornerDownLeft,
  GitBranch,
  Megaphone,
  OctagonX,
  UserCheck,
  Workflow,
  Zap,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import type { KeyboardEvent, ReactNode } from "react";

import {
  collapsedKey,
  findRow,
  groupsAround,
  kindWords,
  outlineMove,
  readCollapsed,
  rowName,
  rowTitle,
  stepDetail,
  stepWords,
  toggled,
} from "../lib/workflow-tree.ts";
import type {
  StepKind,
  TreeGroup,
  TreeRow,
  WorkflowTree,
} from "../lib/workflow-tree.ts";
import { plain, titleOf } from "../lib/workflow-words.ts";
import type { FactRow } from "../lib/workflow-words.ts";

const icons: Record<StepKind, LucideIcon> = {
  action: Zap,
  if: GitBranch,
  wait: Clock,
  wait_for_approval: UserCheck,
  run: Workflow,
  emit: Megaphone,
  fail: OctagonX,
  output: CornerDownLeft,
};

const savedCollapsed = (workflow: string, selected: TreeRow | undefined) => {
  const open = new Set(selected ? groupsAround(selected.path) : []);
  try {
    const saved = readCollapsed(
      window.localStorage.getItem(collapsedKey(workflow))
    );
    return new Set([...saved].filter((path) => !open.has(path)));
  } catch {
    return new Set<string>();
  }
};

const saveCollapsed = (workflow: string, collapsed: ReadonlySet<string>) => {
  try {
    window.localStorage.setItem(
      collapsedKey(workflow),
      JSON.stringify([...collapsed])
    );
  } catch {
    // Without storage the branches open again on the next visit.
  }
};

interface OutlineState {
  selected: TreeRow | undefined;
  collapsed: ReadonlySet<string>;
  onSelect: (row: TreeRow) => void;
  onToggle: (path: string) => void;
  onKey: (row: TreeRow, event: KeyboardEvent) => void;
  /** What each step shows below its sentence, such as a cut or a problem. */
  notes?: ((row: TreeRow) => ReactNode) | undefined;
  /** What the detail shows below the step's inputs. */
  extra?: ((row: TreeRow) => ReactNode) | undefined;
}

const Facts = ({ title, rows }: { title: string; rows: FactRow[] }) =>
  rows.length === 0 ? null : (
    <div className="flex flex-col gap-1">
      <h4 className="text-xs font-medium text-muted-foreground">{title}</h4>
      <dl className="flex flex-col gap-1 text-sm">
        {rows.map((row) => (
          <div key={row.name} className="flex flex-wrap gap-x-2">
            <dt className="font-medium">{titleOf(row.name)}</dt>
            <dd className="min-w-0 break-words text-muted-foreground">
              {row.words}
            </dd>
          </div>
        ))}
      </dl>
    </div>
  );

const Conditions = ({ conditions }: { conditions: string[] }) =>
  conditions.length === 0 ? null : (
    <div className="flex flex-col gap-1">
      <h4 className="text-xs font-medium text-muted-foreground">
        Only when all of these hold
      </h4>
      <ul className="list-disc pl-5 text-sm">
        {conditions.map((condition) => (
          <li key={condition}>{condition}</li>
        ))}
      </ul>
    </div>
  );

const nothingGiven = (row: TreeRow) => {
  const detail = stepDetail(row.step);
  return (
    detail.inputs.length + detail.conditions.length + detail.settings.length ===
    0
  );
};

/** The selected step, read-only: every input and where it comes from. */
export const StepDetailView = ({
  row,
  extra,
}: {
  row: TreeRow;
  extra?: ReactNode;
}) => {
  const detail = stepDetail(row.step);
  return (
    <section
      aria-label={`${rowTitle(row)}, details`}
      className="flex flex-col gap-3 rounded-2xl border p-3"
    >
      <div>
        <h3 className="text-sm font-medium">{rowTitle(row)}</h3>
        <p className="text-sm text-muted-foreground">{stepWords(row.step)}</p>
        <p className="font-mono text-xs text-muted-foreground">{row.address}</p>
      </div>
      <Facts
        title={row.kind === "output" ? "Gives back" : "Takes"}
        rows={detail.inputs}
      />
      <Conditions conditions={detail.conditions} />
      <Facts title="Settings" rows={detail.settings} />
      {nothingGiven(row) ? (
        <p className="text-sm text-muted-foreground">It takes nothing.</p>
      ) : null}
      {extra}
    </section>
  );
};

const GroupToggle = ({
  group,
  open,
  onToggle,
}: {
  group: TreeGroup;
  open: boolean;
  onToggle: () => void;
}) => {
  const Chevron = open ? ChevronDown : ChevronRight;
  const count = `${group.rows.length} ${group.rows.length === 1 ? "step" : "steps"}`;
  return (
    <button
      type="button"
      aria-expanded={open}
      onClick={onToggle}
      className="flex items-center gap-1 rounded-md py-0.5 pr-2 text-xs font-medium text-muted-foreground hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
    >
      <Chevron aria-hidden className="size-3.5" />
      {group.label}
      {open ? null : <span className="font-normal">· {count} hidden</span>}
    </button>
  );
};

const Group = ({ group, state }: { group: TreeGroup; state: OutlineState }) => {
  const open = !state.collapsed.has(group.path);
  return (
    <div className="ml-3 flex flex-col gap-1 border-l pl-3">
      <GroupToggle
        group={group}
        open={open}
        onToggle={() => state.onToggle(group.path)}
      />
      {open ? (
        // oxlint-disable-next-line eslint/no-use-before-define -- recursive: a branch holds rows, and a row holds branches
        <RowList label={group.label} rows={group.rows} state={state} />
      ) : null}
    </div>
  );
};

const Ends = ({ show }: { show: boolean }) =>
  show ? (
    <span className="rounded-full bg-muted px-2 py-0.5 text-xs font-medium">
      Ends the run
    </span>
  ) : null;

const RowButton = ({ row, state }: { row: TreeRow; state: OutlineState }) => {
  const Icon = icons[row.kind];
  const pressed = state.selected?.path === row.path;
  return (
    <button
      type="button"
      data-outline-row={row.path}
      aria-label={rowName(row)}
      aria-pressed={pressed}
      onClick={() => state.onSelect(row)}
      onKeyDown={(event) => state.onKey(row, event)}
      className={`flex w-full min-w-0 items-start gap-2 rounded-xl border px-3 py-2 text-left text-sm focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none ${
        pressed ? "border-foreground/40 bg-muted" : "hover:bg-muted/50"
      }`}
    >
      <Icon aria-hidden className="mt-0.5 size-4 shrink-0" />
      <span className="flex min-w-0 flex-1 flex-col">
        <span className="flex flex-wrap items-center gap-x-2">
          <span className="font-medium">{rowTitle(row)}</span>
          <span className="text-xs text-muted-foreground">
            {kindWords[row.kind]}
          </span>
          <Ends show={row.ends} />
        </span>
        <span className="break-words text-muted-foreground">
          {stepWords(row.step)}
        </span>
      </span>
    </button>
  );
};

const InlineDetail = ({ row, state }: { row: TreeRow; state: OutlineState }) =>
  state.selected?.path === row.path ? (
    <div className="@3xl:hidden">
      <StepDetailView row={row} extra={state.extra?.(row)} />
    </div>
  ) : null;

const Row = ({ row, state }: { row: TreeRow; state: OutlineState }) => (
  <li className="flex flex-col gap-1">
    <RowButton row={row} state={state} />
    {state.notes?.(row)}
    <InlineDetail row={row} state={state} />
    {row.groups.map((group) => (
      <Group key={group.path} group={group} state={state} />
    ))}
  </li>
);

const RowList = ({
  label,
  rows,
  state,
}: {
  label: string;
  rows: TreeRow[];
  state: OutlineState;
}) => (
  <ol aria-label={label} className="flex flex-col gap-1">
    {rows.map((row) => (
      <Row key={row.path} row={row} state={state} />
    ))}
  </ol>
);

const AfterSteps = ({
  tree,
  state,
}: {
  tree: WorkflowTree;
  state: OutlineState;
}) => (
  <>
    {tree.onFailure ? <Group group={tree.onFailure} state={state} /> : null}
    {tree.leaves ? (
      <p className="text-sm text-muted-foreground">
        A step that fails after a commit is left as it is, for a person to put
        right.
      </p>
    ) : null}
    {tree.attentionRole ? (
      <p className="text-sm text-muted-foreground">
        A run that needs attention goes to the {plain(tree.attentionRole)} role.
      </p>
    ) : null}
  </>
);

const useCollapsed = (workflow: string, selected: TreeRow | undefined) => {
  const [collapsed, setCollapsed] = useState(() =>
    savedCollapsed(workflow, selected)
  );
  useEffect(() => {
    saveCollapsed(workflow, collapsed);
  }, [workflow, collapsed]);
  return [collapsed, setCollapsed] as const;
};

export const WorkflowOutline = ({
  workflow,
  tree,
  selected,
  onSelect,
  notes,
  extra,
}: {
  workflow: string;
  tree: WorkflowTree;
  /** The selected step's id or path, from the URL. */
  selected: string | undefined;
  onSelect: (address: string | undefined) => void;
  notes?: (row: TreeRow) => ReactNode;
  extra?: (row: TreeRow) => ReactNode;
}) => {
  const list = useRef<HTMLDivElement>(null);
  const row = findRow(tree, selected);
  const [collapsed, setCollapsed] = useCollapsed(workflow, row);
  const state: OutlineState = {
    selected: row,
    collapsed,
    notes,
    extra,
    onSelect: (next) =>
      onSelect(next.path === row?.path ? undefined : next.address),
    onToggle: (path) => setCollapsed((current) => toggled(current, path)),
    onKey: (from, event) => {
      const move = outlineMove({
        tree,
        collapsed,
        path: from.path,
        key: event.key,
      });
      if (!move) {
        return;
      }
      event.preventDefault();
      if ("focus" in move) {
        list.current
          ?.querySelector<HTMLElement>(`[data-outline-row="${move.focus}"]`)
          ?.focus();
        return;
      }
      setCollapsed((current) =>
        toggled(current, "collapse" in move ? move.collapse : move.expand)
      );
    },
  };
  if (tree.rows.length === 0) {
    return null;
  }
  return (
    <div className="@container">
      <div className="grid gap-4 @3xl:grid-cols-[minmax(0,1fr)_minmax(0,20rem)]">
        <div ref={list} className="flex min-w-0 flex-col gap-2">
          <h2 className="text-sm font-medium">Steps</h2>
          <RowList label="Steps" rows={tree.rows} state={state} />
          <AfterSteps tree={tree} state={state} />
        </div>
        {row ? (
          <div className="hidden @3xl:block">
            <StepDetailView row={row} extra={extra?.(row)} />
          </div>
        ) : null}
      </div>
    </div>
  );
};
