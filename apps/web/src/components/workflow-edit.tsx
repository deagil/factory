// Edit mode for a workflow: a working copy held in the page, checked as it
// changes, and saved into the caller's draft with the revision the page
// read. Also the forms that start a new workflow and delete one.
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useBlocker } from "@tanstack/react-router";
import { Button } from "@workspace/ui/components/button";
import { Input } from "@workspace/ui/components/input";
import { Label } from "@workspace/ui/components/label";
import type { WorkflowCheck, WorkflowDefinition } from "@workspace/workflows";
import { Redo2, Undo2 } from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";
import type { ReactNode } from "react";

import { runAction, runWorkflow } from "../lib/api.ts";
import {
  changed,
  isConflict,
  isDirty,
  newKeyProblem,
  newWorkflow,
  redone,
  startCopy,
  undone,
  workflowPath,
} from "../lib/workflow-edit.ts";
import type { WorkingCopy } from "../lib/workflow-edit.ts";
import { countWords, findingsOf } from "../lib/workflow-problems.ts";
import { workflowTree } from "../lib/workflow-tree.ts";
import { workflowGetKey, workflowListKey } from "../lib/workflows.ts";
import type { WorkflowView } from "../lib/workflows.ts";
import { ErrorText } from "./activity.tsx";
import type { Checked } from "./config-files.tsx";
import { useRefreshDrafts } from "./working-draft.tsx";

const validateKey = "workflow_validate";

interface Validated {
  content: string;
  check: WorkflowCheck;
}

/** A value that settles a moment after it stops changing. */
const useSettled = <T,>(value: T, wait: number): T => {
  const [settled, setSettled] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => setSettled(value), wait);
    return () => clearTimeout(timer);
  }, [value, wait]);
  return settled;
};

const useRefreshWorkflows = () => {
  const client = useQueryClient();
  const refreshDrafts = useRefreshDrafts();
  return () =>
    Promise.all([
      refreshDrafts(),
      client.invalidateQueries({ queryKey: [workflowGetKey] }),
      client.invalidateQueries({ queryKey: [workflowListKey] }),
    ]);
};

interface Editing {
  copy: WorkingCopy;
  /** The file's revision when Edit was pressed: what a save builds on. */
  revision: string | null;
}

export const useWorkflowEdit = (input: {
  workflow: string;
  view: WorkflowView | undefined;
  draftId: string | undefined;
  /** After a save: the page should show the draft. */
  onSaved: () => void;
  /** After a delete: there is nothing left to show. */
  onDeleted: () => void;
}) => {
  const [editing, setEditing] = useState<Editing | null>(null);
  const leaving = useRef(false);
  const refresh = useRefreshWorkflows();
  const copy = editing?.copy ?? null;
  const dirty = isDirty(copy);
  const text = useSettled(copy ? JSON.stringify(copy.value) : null, 400);
  const validated = useQuery({
    queryKey: [validateKey, input.workflow, input.draftId ?? null, text],
    queryFn: async () => {
      const result = await runWorkflow<Validated>(validateKey, {
        key: input.workflow,
        value: text,
        ...(input.draftId ? { draft_id: input.draftId } : {}),
      });
      return result.output;
    },
    enabled: text !== null && dirty,
    placeholderData: (previous) => previous,
  });
  const path = workflowPath(input.workflow);
  const revision = editing?.revision ?? undefined;
  const save = useMutation({
    mutationFn: (value: WorkflowDefinition) =>
      runAction<Checked>("draft.save", {
        path,
        value,
        ...(revision ? { revision } : {}),
      }),
    onSuccess: async () => {
      setEditing(null);
      await refresh();
      input.onSaved();
    },
  });
  const remove = useMutation({
    mutationFn: () =>
      runAction<Checked>("draft.save", {
        path,
        content: null,
        ...(revision ? { revision } : {}),
      }),
    onSuccess: async () => {
      leaving.current = true;
      setEditing(null);
      await refresh();
      input.onDeleted();
    },
  });
  useBlocker({
    shouldBlockFn: ({ current, next }) =>
      dirty &&
      !leaving.current &&
      current.pathname !== next.pathname &&
      // oxlint-disable-next-line no-alert -- the browser's own question, as it asks on closing the tab
      !window.confirm("Leave without saving your edits to this workflow?"),
    enableBeforeUnload: dirty,
  });
  const change = (next: (copy: WorkingCopy) => WorkingCopy) => {
    setEditing((current) =>
      current ? { ...current, copy: next(current.copy) } : current
    );
  };
  return {
    copy,
    dirty,
    /** The check of the working copy, once there is an edit to check. */
    check: dirty ? validated.data?.check : undefined,
    /** The YAML a save would write. */
    content: dirty ? validated.data?.content : undefined,
    checking: dirty && (validated.isFetching || text === null),
    checkError: validated.error,
    save,
    remove,
    start: () => {
      const definition = input.view?.definition;
      if (definition) {
        save.reset();
        remove.reset();
        setEditing({
          copy: startCopy(definition),
          revision: input.view?.revision ?? null,
        });
      }
    },
    stop: () => {
      save.reset();
      setEditing(null);
    },
    /** Drop the working copy and read the file again, after a conflict. */
    reload: async () => {
      save.reset();
      setEditing(null);
      await refresh();
      // The file that changed is in the draft, so that is what to show.
      input.onSaved();
    },
    /** Read the file again but keep the working copy, to compare them. */
    refresh,
    set: (value: WorkflowDefinition) => change((each) => changed(each, value)),
    undo: () => change(undone),
    redo: () => change(redone),
  };
};

export type WorkflowEdit = ReturnType<typeof useWorkflowEdit>;

const statusOf = (edit: WorkflowEdit) => {
  if (!edit.dirty) {
    return "No changes yet.";
  }
  if (edit.checking) {
    return "Checking…";
  }
  if (!edit.check || !edit.copy) {
    return "";
  }
  const found = countWords(
    findingsOf(workflowTree(edit.copy.value), edit.check)
  );
  return found ? `The check found ${found}.` : "The check found nothing wrong.";
};

const Compare = ({
  theirs,
  yours,
}: {
  theirs: string | undefined;
  yours: string | undefined;
}) => (
  <div className="grid gap-3 @3xl:grid-cols-2">
    {[
      { title: "The file now", text: theirs },
      { title: "Your copy", text: yours },
    ].map((side) => (
      <section key={side.title} className="flex min-w-0 flex-col gap-1">
        <h3 className="text-sm font-medium">{side.title}</h3>
        <pre className="overflow-x-auto rounded-2xl bg-muted/50 p-3 font-mono text-xs/relaxed whitespace-pre-wrap">
          {side.text ?? "Loading…"}
        </pre>
      </section>
    ))}
  </div>
);

/** A save refused because the file changed: look at both, or start again. */
const Conflict = ({
  edit,
  theirs,
}: {
  edit: WorkflowEdit;
  theirs: string | undefined;
}) => {
  const [comparing, setComparing] = useState(false);
  return (
    <div
      role="alert"
      className="@container flex flex-col gap-3 rounded-2xl bg-amber-500/10 p-3 text-sm"
    >
      <p>
        <span className="font-medium">Not saved. </span>
        This workflow’s file changed after you started editing, so saving would
        overwrite that change. Compare the two, or reload to start again from
        the file as it is now. Reloading drops your edits.
      </p>
      <div className="flex gap-2">
        <Button
          type="button"
          size="sm"
          variant="outline"
          aria-expanded={comparing}
          onClick={() => {
            setComparing(!comparing);
            void edit.refresh();
          }}
        >
          Compare
        </Button>
        <Button
          type="button"
          size="sm"
          variant="outline"
          onClick={() => {
            void edit.reload();
          }}
        >
          Reload
        </Button>
      </div>
      {comparing ? <Compare theirs={theirs} yours={edit.content} /> : null}
    </div>
  );
};

const EditButtons = ({
  edit,
  waiting,
}: {
  edit: WorkflowEdit;
  waiting: boolean;
}) => {
  const { copy } = edit;
  if (!copy) {
    return null;
  }
  const busy = edit.save.isPending || edit.remove.isPending;
  return (
    <div className="flex flex-wrap items-center gap-2">
      <Button
        type="button"
        size="icon-sm"
        variant="outline"
        aria-label="Undo"
        disabled={copy.past.length === 0}
        onClick={() => edit.undo()}
      >
        <Undo2 aria-hidden />
      </Button>
      <Button
        type="button"
        size="icon-sm"
        variant="outline"
        aria-label="Redo"
        disabled={copy.future.length === 0}
        onClick={() => edit.redo()}
      >
        <Redo2 aria-hidden />
      </Button>
      <Button
        type="button"
        size="sm"
        disabled={!edit.dirty || busy}
        onClick={() => edit.save.mutate(copy.value)}
      >
        {waiting ? "Save and withdraw request" : "Save to draft"}
      </Button>
      <Button
        type="button"
        size="sm"
        variant="outline"
        disabled={busy}
        onClick={() => edit.stop()}
      >
        {edit.dirty ? "Discard edits" : "Stop editing"}
      </Button>
      <Button
        type="button"
        size="sm"
        variant="ghost"
        disabled={busy}
        onClick={() => {
          // oxlint-disable-next-line no-alert -- one question before a file is removed from the draft
          if (window.confirm("Delete this workflow in your draft?")) {
            edit.remove.mutate();
          }
        }}
      >
        Delete workflow
      </Button>
      <p aria-live="polite" className="text-sm text-muted-foreground">
        {statusOf(edit)}
      </p>
    </div>
  );
};

/** The Edit button, or edit mode's own buttons and what a save came back with. */
export const EditBar = ({
  edit,
  block,
  waiting,
  theirs,
}: {
  edit: WorkflowEdit;
  /** Why this can't be edited; empty when the page already says why. */
  block: string | null;
  /** The draft waits for approval, which a save withdraws. */
  waiting: boolean;
  /** The file as the page last read it, to compare after a conflict. */
  theirs: string | undefined;
}) => {
  if (block !== null) {
    return block === "" ? null : (
      <p className="text-sm text-muted-foreground">{block}</p>
    );
  }
  if (!edit.copy) {
    return (
      <div>
        <Button
          type="button"
          size="sm"
          variant="outline"
          onClick={() => edit.start()}
        >
          Edit
        </Button>
      </div>
    );
  }
  const failed = edit.save.error ?? edit.remove.error;
  return (
    <div className="flex flex-col gap-3">
      <EditButtons edit={edit} waiting={waiting} />
      {waiting ? (
        <p className="rounded-2xl bg-amber-500/10 p-3 text-sm">
          Your draft is waiting for approval. Saving another change withdraws
          the request, and you’ll need to ask again.
        </p>
      ) : null}
      {isConflict(failed) ? (
        <Conflict edit={edit} theirs={theirs} />
      ) : (
        <ErrorText error={failed ?? edit.checkError} />
      )}
    </div>
  );
};

/** The description as a field. It is taken when the field is left. */
export const DescriptionField = ({
  value,
  onChange,
}: {
  value: string;
  onChange: (text: string) => void;
}) => {
  const id = useId();
  const [text, setText] = useState(value);
  return (
    <div className="flex flex-col gap-1">
      <Label htmlFor={id}>Description</Label>
      <textarea
        id={id}
        rows={2}
        value={text}
        onChange={(event) => setText(event.target.value)}
        onBlur={() => onChange(text.trim())}
        className="w-full rounded-xl border bg-transparent px-3 py-2 text-sm focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
      />
    </div>
  );
};

const Field = ({
  label,
  children,
  problem,
}: {
  label: string;
  children: (id: string) => ReactNode;
  problem?: string | null;
}) => {
  const id = useId();
  return (
    <div className="flex flex-col gap-1">
      <Label htmlFor={id}>{label}</Label>
      {children(id)}
      {problem ? <p className="text-sm text-destructive">{problem}</p> : null}
    </div>
  );
};

/** Start a workflow in the caller's draft: a key, a description, what starts it. */
export const NewWorkflowForm = ({
  taken,
  events,
  onCreated,
  onCancel,
}: {
  taken: readonly string[];
  /** The events a workflow can start on. */
  events: readonly string[];
  onCreated: (key: string) => void;
  onCancel: () => void;
}) => {
  const [key, setKey] = useState("");
  const [description, setDescription] = useState("");
  const [event, setEvent] = useState("");
  const [tried, setTried] = useState(false);
  const refresh = useRefreshWorkflows();
  const create = useMutation({
    mutationFn: () =>
      runAction<Checked>("draft.save", {
        path: workflowPath(key),
        value: newWorkflow({
          key,
          description: description.trim(),
          event: event === "" ? null : event,
        }),
      }),
    onSuccess: async () => {
      await refresh();
      onCreated(key);
    },
  });
  const keyProblem = newKeyProblem(key, taken);
  const descriptionProblem =
    description.trim() === "" ? "Say what it does." : null;
  return (
    <form
      className="flex max-w-xl flex-col gap-3 rounded-2xl border p-3"
      onSubmit={(submitted) => {
        submitted.preventDefault();
        setTried(true);
        if (keyProblem === null && descriptionProblem === null) {
          create.mutate();
        }
      }}
    >
      <h2 className="text-sm font-medium">New workflow</h2>
      <Field label="Key" problem={tried ? keyProblem : null}>
        {(id) => (
          <Input
            id={id}
            value={key}
            placeholder="deal_follow_up"
            className="font-mono"
            onChange={(changedKey) => setKey(changedKey.target.value)}
          />
        )}
      </Field>
      <Field label="Description" problem={tried ? descriptionProblem : null}>
        {(id) => (
          <Input
            id={id}
            value={description}
            onChange={(next) => setDescription(next.target.value)}
          />
        )}
      </Field>
      <Field label="What starts it">
        {(id) => (
          <select
            id={id}
            value={event}
            onChange={(next) => setEvent(next.target.value)}
            className="h-8 rounded-xl border bg-transparent px-2 text-sm"
          >
            <option value="">When someone runs it</option>
            {events.map((name) => (
              <option key={name} value={name}>
                When the event {name} happens
              </option>
            ))}
          </select>
        )}
      </Field>
      <ErrorText error={create.error} />
      <div className="flex gap-2">
        <Button type="submit" size="sm" disabled={create.isPending}>
          Add to draft
        </Button>
        <Button type="button" size="sm" variant="outline" onClick={onCancel}>
          Cancel
        </Button>
      </div>
    </form>
  );
};
