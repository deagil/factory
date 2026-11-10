// One path of a condition, or a step's failure steps, as a column beside
// the canvas: its steps in order, where the run goes after them, and the
// way back to the condition and across to its other path.
import { Button } from "@workspace/ui/components/button";
import { ArrowRight, ArrowUp, X } from "lucide-react";

import { countWords, findingsByRow } from "../lib/workflow-problems.ts";
import type { Finding } from "../lib/workflow-problems.ts";
import { rowName, rowTitle, stepWords } from "../lib/workflow-tree.ts";
import type { PathView, TreeRow, WorkflowTree } from "../lib/workflow-tree.ts";
import { StepPanel, stepIcons } from "./workflow-outline.tsx";

/** Where the column is: a step, a path, both or neither. */
export interface Place {
  step: string | undefined;
  path: string | undefined;
}

interface PathPanelProps {
  tree: WorkflowTree;
  view: PathView;
  /** The selected step, when it is one of this path's own. */
  selected: TreeRow | undefined;
  findings: readonly Finding[];
  onPlace: (place: Place) => void;
}

const PathStep = ({
  row,
  props,
  found,
}: {
  row: TreeRow;
  props: PathPanelProps;
  found: string | null;
}) => {
  const Icon = stepIcons[row.kind];
  const pressed = props.selected?.path === row.path;
  const { path } = props.view;
  return (
    <li className="flex flex-col gap-1">
      <button
        type="button"
        aria-pressed={pressed}
        aria-label={[rowName(row), found]
          .filter((part) => part !== null)
          .join(", ")}
        onClick={() =>
          props.onPlace({ path, step: pressed ? undefined : row.address })
        }
        className={`flex w-full min-w-0 items-start gap-2 rounded-xl border px-3 py-2 text-left text-sm focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none ${
          pressed ? "border-foreground bg-muted" : "hover:bg-muted/60"
        }`}
      >
        <Icon aria-hidden className="mt-0.5 size-4 shrink-0" />
        <span className="flex min-w-0 flex-1 flex-col">
          <span className="font-medium">{rowTitle(row)}</span>
          <span className="text-xs break-words text-muted-foreground">
            {stepWords(row.step)}
          </span>
          {found ? <span className="text-xs font-medium">{found}</span> : null}
        </span>
      </button>
      {row.groups.length > 0 || row.kind === "if" ? (
        <div className="flex flex-wrap gap-1 pl-3">
          {(row.kind === "if"
            ? [
                { path: `${row.path}.then`, label: "Then" },
                { path: `${row.path}.else`, label: "Otherwise" },
              ]
            : row.groups.map((group) => ({
                path: group.path,
                label: "If it fails",
              }))
          ).map((inner) => (
            <Button
              key={inner.path}
              type="button"
              size="xs"
              variant="outline"
              onClick={() =>
                props.onPlace({ path: inner.path, step: undefined })
              }
            >
              {inner.label}
              <ArrowRight aria-hidden />
            </Button>
          ))}
        </div>
      ) : null}
    </li>
  );
};

export const PathPanel = (props: PathPanelProps) => {
  const { view, selected } = props;
  const byRow = findingsByRow(props.findings);
  const name = `${view.label}, from ${rowTitle(view.owner)}`;
  return (
    <section aria-label={name} className="flex min-w-0 flex-col gap-3">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="text-xs text-muted-foreground">
            {rowTitle(view.owner)}
          </p>
          <h3 className="text-sm font-medium">{view.label}</h3>
        </div>
        <Button
          type="button"
          size="icon-sm"
          variant="ghost"
          aria-label="Close this path"
          onClick={() => props.onPlace({ path: undefined, step: undefined })}
        >
          <X aria-hidden />
        </Button>
      </div>
      <div className="flex flex-wrap gap-1">
        <Button
          type="button"
          size="sm"
          variant="outline"
          onClick={() =>
            props.onPlace({ path: undefined, step: view.owner.address })
          }
        >
          <ArrowUp aria-hidden />
          {rowTitle(view.owner)}
        </Button>
        {view.other ? (
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={() =>
              props.onPlace({ path: view.other?.path, step: undefined })
            }
          >
            {view.other.label}
            <ArrowRight aria-hidden />
          </Button>
        ) : null}
      </div>
      {view.rows.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          No steps. Nothing happens on this path.
        </p>
      ) : (
        <ol aria-label={`Steps of ${name}`} className="flex flex-col gap-1">
          {view.rows.map((row) => (
            <PathStep
              key={row.path}
              row={row}
              props={props}
              found={countWords(byRow.get(row.path) ?? [])}
            />
          ))}
        </ol>
      )}
      <p className="text-sm text-muted-foreground">{view.after}</p>
      {selected ? (
        <StepPanel
          tree={props.tree}
          row={selected}
          findings={props.findings}
          onSelect={(step) => props.onPlace({ path: undefined, step })}
        />
      ) : null}
    </section>
  );
};
