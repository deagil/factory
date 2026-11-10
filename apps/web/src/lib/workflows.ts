// The workflow list and page: who sees which list, how a start and a draft
// change read, and the version, step and tab the page keeps in the URL.
import type {
  Step,
  WorkflowCheck,
  WorkflowDefinition,
} from "@workspace/workflows";

/** The read-only workflow that lists every workflow. */
export const workflowListKey = "workflow_list";

/** The read-only workflow that reads one workflow. */
export const workflowGetKey = "workflow_get";

export type WorkflowChange = "added" | "changed" | "removed" | null;

export type WorkflowWhy = "code" | "no_config_remote" | "past_version";

/** One row of `workflow_list`. */
export interface WorkflowListItem {
  key: string;
  label: string;
  description: string;
  source: "code" | "config";
  path: string | null;
  starts_when: unknown;
  read_only: boolean;
  emits: string[];
  runs: string[];
  problems: number;
  warnings: number;
  change: WorkflowChange;
}

/** One workflow as `workflow_get` returns it. */
export interface WorkflowView {
  definition: WorkflowDefinition | null;
  content: string;
  revision: string | null;
  source: "code" | "config";
  editable: boolean;
  why: WorkflowWhy | null;
  at: {
    kind: "live" | "draft" | "version";
    sha: string | null;
    saved_by: { id: string | null; name: string } | null;
    saved_at: string | null;
  };
  live_revision: string | null;
  behind: boolean;
  check: WorkflowCheck;
}

export interface WorkflowPageSearch {
  /** The File tab. The Workflow tab is the default, so it is left out. */
  tab?: "file";
  /** The selected step, by its id or its path. */
  step?: string;
  /** `draft`, or a commit sha. Absent means the live workflow. */
  v?: string;
}

const commitSha = /^[0-9a-f]{40}$/u;

const text = (value: unknown) =>
  typeof value === "string" && value !== "" ? value : undefined;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

/** The caller may read workflow definitions, not only call them. */
export const canReadWorkflows = (
  workflows: readonly { key: string }[] | undefined
) => workflows?.some((workflow) => workflow.key === workflowListKey) ?? false;

/** The caller may ask for their working draft. */
export const mayReadDrafts = (
  queries: readonly { name: string }[] | undefined
) => queries?.some((query) => query.name === "draft.mine") ?? false;

/** A draft read can start: describe has loaded, and the draft query has settled. */
export const readsAreReady = (
  described: boolean,
  readsDrafts: boolean,
  draft: unknown
) => described && (!readsDrafts || draft !== undefined);

/** A short line for the list. Fuller sentences come with the outline. */
export const whatStarts = (starts: unknown): string => {
  if (starts === "called") {
    return "When someone runs it";
  }
  if (isRecord(starts) && typeof starts.event === "string") {
    return Array.isArray(starts.when) && starts.when.length > 0
      ? `When ${starts.event}, if conditions hold`
      : `When ${starts.event}`;
  }
  if (isRecord(starts) && typeof starts.schedule === "string") {
    return `On the schedule ${starts.schedule}`;
  }
  return "Unknown start";
};

export const sourceLabel = (source: "code" | "config") => {
  switch (source) {
    case "code": {
      return "Code";
    }
    case "config": {
      return "Config";
    }
    default: {
      const never: never = source;
      return never;
    }
  }
};

/** What a draft did to this workflow, or null when it didn't touch it. */
export const draftChangeLabel = (change: WorkflowChange): string | null => {
  switch (change) {
    case "added": {
      return "Added in your draft";
    }
    case "changed": {
      return "Changed in your draft";
    }
    case "removed": {
      return "Removed in your draft";
    }
    case null: {
      return null;
    }
    default: {
      const never: never = change;
      return never;
    }
  }
};

/** The draft has a different copy, so the page can switch to it. */
export const draftChangesWorkflow = (change: WorkflowChange | undefined) =>
  change === "added" || change === "changed" || change === "removed";

/**
 * The side the URL asks for does not have this workflow: it was added only
 * in the draft, or the draft deletes it.
 */
export const workflowMissing = (
  change: WorkflowChange | undefined,
  version: string | undefined
): "only_in_draft" | "removed_in_draft" | null => {
  if (change === "added" && version !== "draft") {
    return "only_in_draft";
  }
  if (change === "removed" && version === "draft") {
    return "removed_in_draft";
  }
  return null;
};

/** `workflow_get` can run: the list has settled, and this version has the file. */
export const workflowGetEnabled = (input: {
  described: boolean;
  ready: boolean;
  missing: ReturnType<typeof workflowMissing>;
  canRead: boolean;
  listFetched: boolean;
}) =>
  input.described &&
  input.ready &&
  input.missing === null &&
  (!input.canRead || input.listFetched);

/** Open a changed or added workflow on the draft; a removed one on live. */
export const versionForChange = (change: WorkflowChange): "draft" | undefined =>
  change === "added" || change === "changed" ? "draft" : undefined;

export const readOnlyReason = (why: WorkflowWhy | null): string | null => {
  switch (why) {
    case "code": {
      return "Written in code and shipped with a release, so it can't be changed here.";
    }
    case "no_config_remote": {
      return "This system reads config from its working tree, so it can't be changed here.";
    }
    case "past_version": {
      return "This is a past version, so it can't be changed here.";
    }
    case null: {
      return null;
    }
    default: {
      const never: never = why;
      return never;
    }
  }
};

/** The header's Read only mark: the workflow never writes, or this view can't be edited. */
export const showsReadOnly = (readOnly: boolean, why: WorkflowWhy | null) =>
  readOnly || why !== null;

/** `?tab=`, `?step=` and `?v=` as the page stores them. Anything else is dropped. */
export const workflowPageSearch = (
  search: Record<string, unknown>
): WorkflowPageSearch => {
  const tab = search.tab === "file" ? "file" : undefined;
  const step = text(search.step);
  const version = text(search.v);
  const v =
    version === "draft" || (version !== undefined && commitSha.test(version))
      ? version
      : undefined;
  return {
    ...(tab ? { tab } : {}),
    ...(step ? { step } : {}),
    ...(v ? { v } : {}),
  };
};

/** The `workflow_get` input for the version in the URL. */
export const workflowReadInput = (
  key: string,
  version: string | undefined,
  draftId: string | undefined
): { key: string; draft_id?: string; sha?: string } => {
  if (version === "draft" && draftId !== undefined) {
    return { key, draft_id: draftId };
  }
  if (version !== undefined && version !== "draft") {
    return { key, sha: version };
  }
  return { key };
};

const stepKind = (
  step: Step
):
  | "action"
  | "if"
  | "wait"
  | "wait_for_approval"
  | "run"
  | "emit"
  | "fail"
  | "output" => {
  if ("action" in step) {
    return "action";
  }
  if ("if" in step) {
    return "if";
  }
  if ("wait" in step) {
    return "wait";
  }
  if ("wait_for_approval" in step) {
    return "wait_for_approval";
  }
  if ("run" in step) {
    return "run";
  }
  if ("emit" in step) {
    return "emit";
  }
  if ("fail" in step) {
    return "fail";
  }
  if ("output" in step) {
    return "output";
  }
  const never: never = step;
  return never;
};

const textOr = (
  first: string | undefined,
  second: string | undefined,
  fallback: string
) => first ?? second ?? fallback;

const sourceOf = (
  view: WorkflowView | undefined,
  item: WorkflowListItem | undefined
) => view?.source ?? item?.source;

const readOnlyOf = (
  definition: WorkflowDefinition | null,
  item: WorkflowListItem | undefined
) => definition?.read_only === true || item?.read_only === true;

const whyOf = (view: WorkflowView | undefined) => view?.why ?? null;

const startsOf = (
  definition: WorkflowDefinition | null,
  item: WorkflowListItem | undefined
) => whatStarts(definition?.starts_when ?? item?.starts_when);

const stepsOf = (definition: WorkflowDefinition | null) =>
  definition?.steps ?? [];

const contentOf = (view: WorkflowView | undefined) => view?.content ?? null;

const tabOf = (tab: WorkflowPageSearch["tab"]): "workflow" | "file" =>
  tab === "file" ? "file" : "workflow";

const missingCopy = {
  only_in_draft: "This workflow is only in your draft.",
  removed_in_draft: "Your draft removes this workflow.",
} as const;

const missingTextOf = (
  missing: ReturnType<typeof workflowMissing>
): string | null => (missing ? missingCopy[missing] : null);

/** The page's text, taken from the draft's row until the workflow itself loads. */
export const presentWorkflow = (input: {
  key: string;
  search: WorkflowPageSearch;
  item: WorkflowListItem | undefined;
  view: WorkflowView | undefined;
  missing: ReturnType<typeof workflowMissing>;
}) => {
  const definition = input.view?.definition ?? null;
  const why = whyOf(input.view);
  return {
    label: textOr(definition?.label, input.item?.label, input.key),
    description: textOr(definition?.description, input.item?.description, ""),
    source: sourceOf(input.view, input.item),
    readOnly: readOnlyOf(definition, input.item),
    why,
    reason: readOnlyReason(why),
    starts: startsOf(definition, input.item),
    steps: stepsOf(definition),
    content: contentOf(input.view),
    tab: tabOf(input.search.tab),
    missingText: missingTextOf(input.missing),
  };
};

/** The step's id, or for a `fail` or `output` with none, its kind. */
export const stepLabel = (step: Step): string => {
  if ("id" in step && step.id) {
    return step.id;
  }
  const kind = stepKind(step);
  switch (kind) {
    case "fail": {
      return "fail" in step ? step.fail : "fail";
    }
    case "output": {
      return "output";
    }
    case "action":
    case "if":
    case "wait":
    case "wait_for_approval":
    case "run":
    case "emit": {
      return kind;
    }
    default: {
      const never: never = kind;
      return never;
    }
  }
};
