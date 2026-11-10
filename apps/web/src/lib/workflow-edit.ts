// Edit mode's working copy: the definition as it is being changed in the
// page, with what to go back to. Nothing is saved until Save to draft sends
// the value with the revision the page read.
import type { WorkflowDefinition } from "@workspace/workflows";

import { ApiCallError } from "./api.ts";

export interface WorkingCopy {
  /** The definition as the page read it, or as it was last saved. */
  saved: WorkflowDefinition;
  value: WorkflowDefinition;
  past: WorkflowDefinition[];
  future: WorkflowDefinition[];
}

const same = (a: unknown, b: unknown) =>
  JSON.stringify(a) === JSON.stringify(b);

export const startCopy = (definition: WorkflowDefinition): WorkingCopy => ({
  saved: definition,
  value: definition,
  past: [],
  future: [],
});

/** One change. A change that changes nothing leaves no step to undo. */
export const changed = (
  copy: WorkingCopy,
  value: WorkflowDefinition
): WorkingCopy =>
  same(copy.value, value)
    ? copy
    : { ...copy, value, past: [...copy.past, copy.value], future: [] };

export const undone = (copy: WorkingCopy): WorkingCopy => {
  const value = copy.past.at(-1);
  return value
    ? {
        ...copy,
        value,
        past: copy.past.slice(0, -1),
        future: [copy.value, ...copy.future],
      }
    : copy;
};

export const redone = (copy: WorkingCopy): WorkingCopy => {
  const [value, ...future] = copy.future;
  return value
    ? { ...copy, value, past: [...copy.past, copy.value], future }
    : copy;
};

/** There are edits a save would send. */
export const isDirty = (copy: WorkingCopy | null): boolean =>
  copy !== null && !same(copy.saved, copy.value);

/** Where a config workflow's file is. */
export const workflowPath = (key: string) => `config/workflows/${key}.yaml`;

/** The definition with a new description. An empty one is kept, for the check to refuse. */
export const withDescription = (
  definition: WorkflowDefinition,
  description: string
): WorkflowDefinition => ({ ...definition, description });

/** Why this view can't be edited, or null when it can. */
export const editBlock = (input: {
  /** `workflow_get` says the file can be changed. */
  editable: boolean;
  /** The caller's roles let them save drafts. */
  canSave: boolean;
  /** `draft`, a sha, or undefined for live. */
  version: string | undefined;
  /** The caller's draft already changes this workflow. */
  inDraft: boolean;
}): string | null => {
  if (!input.editable) {
    // The page already says why: code, no config remote or a past version.
    return "";
  }
  if (!input.canSave) {
    return "Your roles don't let you change config.";
  }
  if (input.version === undefined && input.inDraft) {
    return "Your draft already changes this workflow. Switch to your draft to go on editing it.";
  }
  return null;
};

/** A save that was refused because the file changed since the page read it. */
export const isConflict = (error: unknown): boolean =>
  error instanceof ApiCallError && error.error.code === "conflict";

const keyPattern = /^[a-z][a-z0-9]*(?:_[a-z0-9]+)*$/u;

/** What is wrong with a new workflow's key, or null. */
export const newKeyProblem = (
  key: string,
  taken: readonly string[]
): string | null => {
  if (key === "") {
    return "Give it a key.";
  }
  if (!keyPattern.test(key)) {
    return "Use lower-case letters, numbers and underscores, starting with a letter: deal_follow_up.";
  }
  return taken.includes(key)
    ? `There is already a workflow called ${key}.`
    : null;
};

/** The smallest workflow that passes the check: it gives back nothing. */
export const newWorkflow = (input: {
  key: string;
  description: string;
  /** An event's name, or null to start when someone runs it. */
  event: string | null;
}): WorkflowDefinition => ({
  key: input.key,
  description: input.description,
  starts_when: input.event === null ? "called" : { event: input.event },
  steps: [{ output: {} }],
});
