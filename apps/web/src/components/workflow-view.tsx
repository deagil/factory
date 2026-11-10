// The Workflow tab, top to bottom as a run goes: what starts it, what it
// takes, its steps with the places it commits, what it gives back, how it
// can fail, who can call it and who it acts as.
import type { WorkflowCheck } from "@workspace/workflows";
import { CircleAlert, Scissors, Send, TriangleAlert } from "lucide-react";
import type { ReactNode } from "react";

import type { Role } from "../lib/roles.ts";
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
import { allRows, rowTitle } from "../lib/workflow-tree.ts";
import type { WorkflowTree } from "../lib/workflow-tree.ts";
import { titleOf } from "../lib/workflow-words.ts";
import type {
  FactRow,
  StartWords,
  WorkflowFacts,
} from "../lib/workflow-words.ts";
import { WorkflowOutline } from "./workflow-outline.tsx";

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
  selected: string | undefined;
  onSelect: (step: string | undefined) => void;
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

export const WorkflowTab = (props: WorkflowTabProps) => {
  const findings = findingsOf(props.tree, props.check);
  const cuts = cutsOf(props.check);
  const queued = queuedOf(props.check);
  const rows = allRows(props.tree).filter((row) => row.id !== null);
  const before = new Map(
    rows.map((row) => [
      row.path,
      <CutLine key="cut" cut={cuts.get(row.id ?? "")} />,
    ])
  );
  const notes = new Map(
    rows.map((row) => [
      row.path,
      <Queued key="queued" show={queued.has(row.id ?? "")} />,
    ])
  );
  if (props.tree.rows.length === 0) {
    return <Description text={props.description} />;
  }
  return (
    <>
      <Description text={props.description} />
      <Summary findings={findings} onSelect={props.onSelect} />
      <Starts starts={props.starts} />
      <FactList title="What it takes" rows={props.facts.input} code={false} />
      <Pauses count={cuts.size} />
      <WorkflowOutline
        workflow={props.workflow}
        tree={props.tree}
        selected={props.selected}
        onSelect={props.onSelect}
        findings={findings}
        before={before}
        notes={notes}
      />
      <FactList
        title="What it gives back"
        rows={props.facts.output}
        code={false}
      />
      <FactList title="How it can fail" rows={props.facts.errors} code />
      <Access
        workflow={props.workflow}
        startsWhen={props.startsWhen}
        roles={props.roles}
        check={props.check}
      />
    </>
  );
};
