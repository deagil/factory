import { Button } from "@workspace/ui/components/button";
// The Workflow tab, top to bottom as a run goes: what starts it, what it
// takes, its steps with the places it commits, what it gives back, how it
// can fail, who can call it and who it acts as.
import type { WorkflowCheck } from "@workspace/workflows";
import { CircleAlert, Scissors, Send, TriangleAlert } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";

import type { Role } from "../lib/roles.ts";
import type { EventStarts } from "../lib/workflow-events.ts";
import { countWords, findingsOf } from "../lib/workflow-problems.ts";
import type { Finding } from "../lib/workflow-problems.ts";
import {
  actsAsWords,
  callersWords,
  cutsOf,
  inputWarnings,
  pauseWords,
  queuedOf,
} from "../lib/workflow-segments.ts";
import type { Cut } from "../lib/workflow-segments.ts";
import { allRows, findRow, pathView, rowTitle } from "../lib/workflow-tree.ts";
import type { TreeRow, WorkflowTree } from "../lib/workflow-tree.ts";
import { listOf, titleOf } from "../lib/workflow-words.ts";
import type {
  FactRow,
  StartWords,
  WorkflowFacts,
} from "../lib/workflow-words.ts";
import { WorkflowCanvas } from "./workflow-canvas.tsx";
import { DescriptionField } from "./workflow-edit.tsx";
import { EventStartsList } from "./workflow-events.tsx";
import { StepPanel, WorkflowOutline } from "./workflow-outline.tsx";
import { PathPanel } from "./workflow-path.tsx";
import type { Place } from "./workflow-path.tsx";
import { AddStep, StepCommands, useStepEdit } from "./workflow-step-edit.tsx";
import type { StepEdit, StepEditing } from "./workflow-step-edit.tsx";
import { StepValues } from "./workflow-value.tsx";

export interface WorkflowTabProps {
  workflow: string;
  description: string;
  starts: StartWords;
  /** `starts_when` as the file has it. */
  startsWhen: unknown;
  facts: WorkflowFacts;
  tree: WorkflowTree;
  check: WorkflowCheck | undefined;
  /** Undefined when the viewer can't read roles. */
  roles: readonly Role[] | undefined;
  /** The events it emits, with the workflows each one starts. */
  next: EventStarts[];
  selected: string | undefined;
  onSelect: (step: string | undefined) => void;
  /** The path open beside the canvas, such as `steps.1.then`. */
  path: string | undefined;
  /** Go to a step, a path, both or neither, in one move. */
  onPlace: (place: Place) => void;
  /** In edit mode: the working copy's steps, and how to change them. */
  editing?: StepEditing | undefined;
  /** In edit mode: take a new description. */
  onDescription?: ((text: string) => void) | undefined;
  /** `list` when the viewer chose the outline over the canvas. */
  view: "list" | undefined;
  onView: (view: "list" | undefined) => void;
}

const Section = ({
  title,
  children,
}: {
  title: string;
  children: ReactNode;
}) => (
  <section className="flex flex-col gap-1">
    <h2 className="text-sm font-medium">{title}</h2>
    {children}
  </section>
);

const FactList = ({
  title,
  rows,
  code,
}: {
  title: string;
  rows: FactRow[];
  code: boolean;
}) =>
  rows.length === 0 ? null : (
    <Section title={title}>
      <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-sm">
        {rows.map((row) => (
          <div key={row.name} className="contents">
            <dt className={code ? "font-mono text-xs/5" : undefined}>
              {code ? row.name : titleOf(row.name)}
            </dt>
            <dd className="text-muted-foreground">{row.words}</dd>
          </div>
        ))}
      </dl>
    </Section>
  );

const Starts = ({ starts }: { starts: StartWords }) => (
  <Section title="What starts it">
    <p className="text-sm">
      {starts.text}
      {starts.local ? (
        <span className="text-muted-foreground"> ({starts.local})</span>
      ) : null}
    </p>
  </Section>
);

const Description = ({ text }: { text: string }) =>
  text === "" ? null : <p className="text-sm">{text}</p>;

/** A divider above the step that cuts: everything before it commits. */
const CutLine = ({ cut }: { cut: Cut | undefined }) =>
  cut ? (
    <p className="flex items-center gap-2 py-1 text-xs font-medium">
      <Scissors aria-hidden className="size-3.5 shrink-0" />
      <span>{cut.text}</span>
      <span
        aria-hidden
        className="h-px min-w-4 flex-1 border-t border-dashed"
      />
    </p>
  ) : null;

const Queued = ({ show }: { show: boolean }) =>
  show ? (
    <p className="flex items-center gap-2 pl-3 text-xs text-muted-foreground">
      <Send aria-hidden className="size-3.5 shrink-0" />
      Sent after the commit, outside the transaction.
    </p>
  ) : null;

const Pauses = ({ count }: { count: number }) => {
  const words = pauseWords(count);
  return words ? (
    <p className="flex items-center gap-2 text-sm">
      <Scissors aria-hidden className="size-4 shrink-0" />
      {words}
    </p>
  ) : null;
};

const Warnings = ({ check }: { check: WorkflowCheck | undefined }) => (
  <>
    {inputWarnings(check).map((warning) => (
      <p key={warning.message} className="flex items-start gap-2 text-sm">
        <TriangleAlert aria-hidden className="mt-0.5 size-4 shrink-0" />
        <span>
          <span className="font-medium">Warning: </span>
          {warning.message}
        </span>
      </p>
    ))}
  </>
);

const where = (finding: Finding) =>
  [finding.row ? rowTitle(finding.row) : null, finding.field]
    .filter((part) => part !== null)
    .join(", ");

const SummaryLine = ({
  finding,
  onSelect,
}: {
  finding: Finding;
  onSelect: (step: string) => void;
}) => {
  const Icon = finding.kind === "problem" ? CircleAlert : TriangleAlert;
  const { row } = finding;
  return (
    <li className="flex items-start gap-2 text-sm">
      <Icon aria-hidden className="mt-0.5 size-4 shrink-0" />
      <span className="min-w-0 break-words">
        <span className="font-medium">
          {finding.kind === "problem" ? "Problem" : "Warning"}
        </span>
        {row ? (
          <>
            {" at "}
            <button
              type="button"
              className="rounded-sm underline underline-offset-2 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
              onClick={() => onSelect(row.address)}
            >
              {where(finding)}
            </button>
          </>
        ) : (
          ` in ${where(finding)}`
        )}
        : {finding.message}
      </span>
    </li>
  );
};

/** Every problem and warning, with a link to the step each is on. */
const Summary = ({
  findings,
  onSelect,
}: {
  findings: Finding[];
  onSelect: (step: string) => void;
}) => {
  const words = countWords(findings);
  return words ? (
    <Section title={`What the check found: ${words}`}>
      <ul className="flex flex-col gap-1">
        {findings.map((finding) => (
          <SummaryLine
            key={`${finding.row?.path}:${finding.field}:${finding.message}`}
            finding={finding}
            onSelect={onSelect}
          />
        ))}
      </ul>
    </Section>
  ) : null;
};

const Access = ({
  workflow,
  startsWhen,
  roles,
  check,
}: Pick<WorkflowTabProps, "workflow" | "startsWhen" | "roles" | "check">) => (
  <Section title="Who can call it, and who it acts as">
    <p className="text-sm">
      {callersWords({ starts: startsWhen, roles, workflow })}
    </p>
    <p className="text-sm text-muted-foreground">{actsAsWords}</p>
    <Warnings check={check} />
  </Section>
);

/** The canvas needs room: below 48rem of pane, the steps are the outline. */
const canvasFloor = 768;

const useWide = () => {
  const pane = useRef<HTMLDivElement>(null);
  const [wide, setWide] = useState(false);
  useEffect(() => {
    const element = pane.current;
    if (!element) {
      return;
    }
    const measure = () => {
      setWide(element.getBoundingClientRect().width >= canvasFloor);
    };
    // Measured once here too: a page in the background gets no resize calls.
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  return { pane, wide };
};

const ViewSwitch = ({
  view,
  onView,
}: Pick<WorkflowTabProps, "view" | "onView">) => (
  <fieldset className="flex gap-1">
    <legend className="sr-only">Show the steps as</legend>
    <Button
      type="button"
      size="sm"
      variant={view === "list" ? "ghost" : "secondary"}
      aria-pressed={view !== "list"}
      onClick={() => onView(undefined)}
    >
      Canvas
    </Button>
    <Button
      type="button"
      size="sm"
      variant={view === "list" ? "secondary" : "ghost"}
      aria-pressed={view === "list"}
      onClick={() => onView("list")}
    >
      List
    </Button>
  </fieldset>
);

const endWords = (facts: WorkflowFacts) =>
  facts.output.length === 0
    ? "Ends"
    : `Gives back ${listOf(facts.output.map((row) => titleOf(row.name).toLowerCase()))}`;

/** Edit mode's tools above the steps: what was said, add, and the selected step. */
const EditTools = ({
  edit,
  row,
  editing,
  scopes,
  canvas,
}: {
  edit: StepEdit;
  row: TreeRow | undefined;
  editing: StepEditing | undefined;
  scopes: WorkflowCheck["scopes"] | undefined;
  canvas: boolean;
}) => {
  const shown = edit.adding ? undefined : row;
  return (
    <>
      <p aria-live="polite" className="text-sm text-muted-foreground">
        {edit.said}
      </p>
      <AddStep edit={edit} />
      {shown ? <StepCommands row={shown} edit={edit} /> : null}
      {shown && editing ? (
        <StepValues row={shown} editing={editing} scopes={scopes} />
      ) : null}
      {!row && !edit.adding && !canvas ? (
        <div>
          <Button
            size="sm"
            variant="outline"
            onClick={() => edit.startAdding({ list: "steps", index: 0 })}
          >
            Add a step at the start
          </Button>
        </div>
      ) : null}
    </>
  );
};

/** The steps: a flowchart when the pane is wide, the outline otherwise. */
const Steps = (props: WorkflowTabProps & { findings: Finding[] }) => {
  const { pane, wide } = useWide();
  const cuts = cutsOf(props.check);
  const queued = queuedOf(props.check);
  const rows = allRows(props.tree).filter((row) => row.id !== null);
  const row = findRow(props.tree, props.selected);
  const canvas = wide && props.view !== "list";
  const open = pathView(props.tree, props.path);
  const inPath = open?.rows.some((each) => each.path === row?.path) ?? false;
  const stepEdit = useStepEdit({
    editing: props.editing,
    tree: props.tree,
    selected: row,
    onPlace: props.onPlace,
  });
  return (
    // oxlint-disable-next-line jsx-a11y/no-static-element-interactions -- Alt with an arrow moves the selected step, from wherever the focus is among the steps
    <div
      ref={pane}
      className="flex flex-col gap-2"
      onKeyDown={(event) => stepEdit.onKey(event)}
    >
      {wide ? (
        <div className="flex items-center justify-between gap-2">
          <h2 className="text-sm font-medium">Steps</h2>
          <ViewSwitch view={props.view} onView={props.onView} />
        </div>
      ) : null}
      {stepEdit.active ? (
        <EditTools
          edit={stepEdit}
          row={row}
          editing={props.editing}
          scopes={props.check?.scopes}
          canvas={canvas}
        />
      ) : null}
      {canvas ? (
        <div
          className={
            row || open
              ? "grid grid-cols-[minmax(0,1fr)_20rem] gap-4"
              : undefined
          }
        >
          <WorkflowCanvas
            tree={props.tree}
            selected={row}
            onSelect={(step) =>
              props.onPlace({
                step,
                path:
                  open?.rows.some((each) => each.address === step) === true
                    ? open.path
                    : undefined,
              })
            }
            path={open?.path}
            onPath={(path) => props.onPlace({ path, step: undefined })}
            edit={
              stepEdit.active
                ? {
                    adding: stepEdit.adding,
                    onAdd: stepEdit.startAdding,
                    onDrop: stepEdit.drop,
                  }
                : undefined
            }
            findings={props.findings}
            cuts={cuts}
            queued={queued}
            startText={props.starts.text}
            endText={endWords(props.facts)}
          />
          {open ? (
            <PathPanel
              tree={props.tree}
              view={open}
              selected={inPath ? row : undefined}
              findings={props.findings}
              onPlace={props.onPlace}
            />
          ) : null}
          {row && !open ? (
            <StepPanel
              tree={props.tree}
              row={row}
              findings={props.findings}
              onSelect={props.onSelect}
            />
          ) : null}
        </div>
      ) : (
        <WorkflowOutline
          workflow={props.workflow}
          tree={props.tree}
          selected={props.selected}
          onSelect={props.onSelect}
          findings={props.findings}
          heading={!wide}
          before={
            new Map(
              rows.map((each) => [
                each.path,
                <CutLine key="cut" cut={cuts.get(each.id ?? "")} />,
              ])
            )
          }
          notes={
            new Map(
              rows.map((each) => [
                each.path,
                <Queued key="queued" show={queued.has(each.id ?? "")} />,
              ])
            )
          }
        />
      )}
    </div>
  );
};

export const WorkflowTab = (props: WorkflowTabProps) => {
  const findings = findingsOf(props.tree, props.check);
  if (props.tree.rows.length === 0) {
    return <Description text={props.description} />;
  }
  return (
    <>
      {props.onDescription ? (
        <DescriptionField
          // Undo and redo bring another value, which starts the field afresh.
          key={props.description}
          value={props.description}
          onChange={props.onDescription}
        />
      ) : (
        <Description text={props.description} />
      )}
      <Summary findings={findings} onSelect={props.onSelect} />
      <Starts starts={props.starts} />
      <FactList title="What it takes" rows={props.facts.input} code={false} />
      <Pauses count={cutsOf(props.check).size} />
      <Steps {...props} findings={findings} />
      <FactList
        title="What it gives back"
        rows={props.facts.output}
        code={false}
      />
      <FactList title="How it can fail" rows={props.facts.errors} code />
      {props.next.length > 0 ? (
        <Section title="What happens next">
          <EventStartsList rows={props.next} />
        </Section>
      ) : null}
      <Access
        workflow={props.workflow}
        startsWhen={props.startsWhen}
        roles={props.roles}
        check={props.check}
      />
    </>
  );
};
