// Edit mode's changes to steps: add, move, duplicate, rename and remove.
// The buttons here, the keys and a drop on the canvas all call the same
// functions in `lib/workflow-steps.ts`, and each says what it did.
import { useQuery } from "@tanstack/react-query";
import { Button } from "@workspace/ui/components/button";
import { Input } from "@workspace/ui/components/input";
import { Label } from "@workspace/ui/components/label";
import type { WorkflowDefinition } from "@workspace/workflows";
import {
  ArrowDown,
  ArrowUp,
  Copy,
  CornerDownRight,
  CornerLeftUp,
  Plus,
  Trash2,
} from "lucide-react";
import { useId, useState } from "react";
import type { KeyboardEvent } from "react";

import { readWorkflow } from "../lib/api.ts";
import { actionListKey } from "../lib/workflow-events.ts";
import type { ActionListItem } from "../lib/workflow-events.ts";
import {
  duplicateStep,
  idProblem,
  insertStep,
  moveBy,
  moveInto,
  moveOut,
  moveStep,
  newStep,
  removeStep,
  renameStep,
  slotOf,
  stepAt,
} from "../lib/workflow-steps.ts";
import type { Changed, NewStep, Slot } from "../lib/workflow-steps.ts";
import { readersOf, rowTitle } from "../lib/workflow-tree.ts";
import type { TreeRow, WorkflowTree } from "../lib/workflow-tree.ts";
import { listOf, titleOf } from "../lib/workflow-words.ts";
import type { Place } from "./workflow-path.tsx";

/** The working copy's definition, and how to change it. */
export interface StepEditing {
  definition: WorkflowDefinition;
  onChange: (definition: WorkflowDefinition) => void;
  draftId: string | undefined;
}

const addressAt = (definition: WorkflowDefinition, path: string) => {
  const step = stepAt(definition, path);
  return step && "id" in step && step.id ? step.id : path;
};

/** The question before a step whose output is read is removed, or null. */
const removalQuestion = (tree: WorkflowTree, row: TreeRow): string | null => {
  const readers = (readersOf(tree).get(row.id ?? "") ?? []).map(rowTitle);
  const all = [
    ...readers,
    ...(tree.outputReads.includes(row.id ?? "")
      ? ["what the workflow gives back"]
      : []),
  ];
  return all.length > 0
    ? `${rowTitle(row)}'s output is read by ${listOf(all, "and")}. Remove it anyway?`
    : null;
};

const moves = {
  ArrowUp: "up",
  ArrowDown: "down",
  ArrowRight: "into",
  ArrowLeft: "out",
} as const;

type Move = (typeof moves)[keyof typeof moves];

const isMoveKey = (key: string): key is keyof typeof moves => key in moves;

const moved = (
  definition: WorkflowDefinition,
  path: string,
  how: Move
): { result: Changed | null; done: string; refused: string } => {
  switch (how) {
    case "up": {
      return {
        result: moveBy(definition, path, -1),
        done: "up",
        refused: "It is already first.",
      };
    }
    case "down": {
      return {
        result: moveBy(definition, path, 1),
        done: "down",
        refused: "It is already last.",
      };
    }
    case "into": {
      return {
        result: moveInto(definition, path),
        done: "into the condition before it",
        refused: "The step before it is not a condition.",
      };
    }
    default: {
      return {
        result: moveOut(definition, path),
        done: "out of its path",
        refused: "It is not inside a path.",
      };
    }
  }
};

export const useStepEdit = (input: {
  editing: StepEditing | undefined;
  tree: WorkflowTree;
  selected: TreeRow | undefined;
  onPlace: (place: Place) => void;
}) => {
  const { editing, tree, selected, onPlace } = input;
  const [adding, setAdding] = useState<Slot | null>(null);
  const [said, setSaid] = useState("");
  const take = (result: Changed | null, done: string, refused: string) => {
    if (!editing) {
      return;
    }
    if (!result) {
      setSaid(refused);
      return;
    }
    editing.onChange(result.definition);
    onPlace({
      step: addressAt(result.definition, result.path),
      path: undefined,
    });
    setSaid(done);
  };
  const move = (row: TreeRow, how: Move) => {
    if (editing) {
      const { result, done, refused } = moved(
        editing.definition,
        row.path,
        how
      );
      take(
        result,
        `Moved ${rowTitle(row)} ${done}.`,
        `${rowTitle(row)} can't move ${how}. ${refused}`
      );
    }
  };
  return {
    active: editing !== undefined,
    definition: editing?.definition,
    draftId: editing?.draftId,
    adding,
    said,
    startAdding: (slot: Slot | null) => setAdding(slot),
    add: (choice: NewStep) => {
      if (editing && adding) {
        const step = newStep(editing.definition, choice);
        take(
          insertStep(editing.definition, adding, step),
          `Added ${"id" in step && step.id ? titleOf(step.id) : "a step"}.`,
          ""
        );
        setAdding(null);
      }
    },
    /** A drop on the canvas: the step at `path` goes to the slot. */
    drop: (path: string, slot: Slot) => {
      if (editing) {
        take(
          moveStep(editing.definition, path, slot),
          "Moved the step.",
          "That leaves the step where it is."
        );
      }
    },
    move,
    duplicate: (row: TreeRow) => {
      if (editing) {
        take(
          duplicateStep(editing.definition, row.path),
          `Copied ${rowTitle(row)}.`,
          ""
        );
      }
    },
    rename: (row: TreeRow, id: string) => {
      if (editing && row.id) {
        editing.onChange(renameStep(editing.definition, row.id, id));
        onPlace({ step: id, path: undefined });
        setSaid(`Renamed ${row.id} to ${id}.`);
      }
    },
    remove: (row: TreeRow) => {
      const question = removalQuestion(tree, row);
      // oxlint-disable-next-line no-alert -- one question before other steps lose what they read
      if (!editing || (question !== null && !window.confirm(question))) {
        return;
      }
      editing.onChange(removeStep(editing.definition, row.path));
      onPlace({ step: undefined, path: undefined });
      setSaid(`Removed ${rowTitle(row)}.`);
    },
    /** Alt with an arrow moves the selected step. */
    onKey: (event: KeyboardEvent) => {
      if (editing && selected && event.altKey && isMoveKey(event.key)) {
        event.preventDefault();
        move(selected, moves[event.key]);
      }
    },
  };
};

export type StepEdit = ReturnType<typeof useStepEdit>;

const Rename = ({ row, edit }: { row: TreeRow; edit: StepEdit }) => {
  const field = useId();
  const [id, setId] = useState(row.id ?? "");
  const { definition } = edit;
  if (!row.id || !definition) {
    return null;
  }
  const problem = id === row.id ? null : idProblem(definition, id, row.id);
  return (
    <form
      className="flex flex-wrap items-end gap-2"
      onSubmit={(event) => {
        event.preventDefault();
        if (problem === null && id !== row.id) {
          edit.rename(row, id);
        }
      }}
    >
      <div className="flex flex-col gap-1">
        <Label htmlFor={field}>Id</Label>
        <Input
          id={field}
          value={id}
          className="h-7 w-48 font-mono text-xs"
          onChange={(event) => setId(event.target.value)}
        />
      </div>
      <Button
        type="submit"
        size="sm"
        variant="outline"
        disabled={id === row.id || problem !== null}
      >
        Rename
      </Button>
      {problem ? <p className="text-sm text-destructive">{problem}</p> : null}
    </form>
  );
};

/** What can be done to the selected step. Alt with an arrow moves it too. */
export const StepCommands = ({
  row,
  edit,
}: {
  row: TreeRow;
  edit: StepEdit;
}) => {
  const after = slotOf(row.path);
  return (
    <section
      aria-label={`Change ${rowTitle(row)}`}
      className="flex flex-col gap-2 rounded-2xl border p-3"
    >
      <h3 className="text-sm font-medium">{rowTitle(row)}</h3>
      <div className="flex flex-wrap gap-1">
        <Button
          size="sm"
          variant="outline"
          onClick={() => edit.move(row, "up")}
        >
          <ArrowUp aria-hidden />
          Up
        </Button>
        <Button
          size="sm"
          variant="outline"
          onClick={() => edit.move(row, "down")}
        >
          <ArrowDown aria-hidden />
          Down
        </Button>
        <Button
          size="sm"
          variant="outline"
          onClick={() => edit.move(row, "into")}
        >
          <CornerDownRight aria-hidden />
          Into the condition before
        </Button>
        <Button
          size="sm"
          variant="outline"
          onClick={() => edit.move(row, "out")}
        >
          <CornerLeftUp aria-hidden />
          Out of this path
        </Button>
        <Button
          size="sm"
          variant="outline"
          onClick={() =>
            edit.startAdding({ list: after.list, index: after.index + 1 })
          }
        >
          <Plus aria-hidden />
          Add a step after
        </Button>
        <Button size="sm" variant="outline" onClick={() => edit.duplicate(row)}>
          <Copy aria-hidden />
          Duplicate
        </Button>
        <Button size="sm" variant="outline" onClick={() => edit.remove(row)}>
          <Trash2 aria-hidden />
          Remove
        </Button>
      </div>
      {/* Another step, or another id after a rename, starts the field afresh. */}
      <Rename key={row.id ?? row.path} row={row} edit={edit} />
      <p className="text-xs text-muted-foreground">
        Alt with an arrow key moves it: up, down, right into the condition
        before, left out of its path. On the canvas, drag it to a plus.
      </p>
    </section>
  );
};

const fetchActions = async (draftId: string | undefined) => {
  const result = await readWorkflow<{ actions: ActionListItem[] }>(
    actionListKey,
    draftId ? { draft_id: draftId } : {}
  );
  return result.output.actions;
};

/** Pick the kind of step to put at the slot. Its details are set once it is there. */
export const AddStep = ({ edit }: { edit: StepEdit }) => {
  const field = useId();
  const [action, setAction] = useState("");
  const actions = useQuery({
    queryKey: [actionListKey, edit.draftId ?? null],
    queryFn: () => fetchActions(edit.draftId),
    enabled: edit.adding !== null,
  });
  if (!edit.adding) {
    return null;
  }
  return (
    <section
      aria-label="Add a step"
      className="flex flex-col gap-3 rounded-2xl border p-3"
    >
      <h3 className="text-sm font-medium">Add a step</h3>
      <form
        className="flex flex-wrap items-end gap-2"
        onSubmit={(event) => {
          event.preventDefault();
          if (action !== "") {
            edit.add({ kind: "action", action });
          }
        }}
      >
        <div className="flex flex-col gap-1">
          <Label htmlFor={field}>Run an action</Label>
          <select
            id={field}
            value={action}
            onChange={(event) => setAction(event.target.value)}
            className="h-8 max-w-64 rounded-xl border bg-transparent px-2 text-sm"
          >
            <option value="">Choose an action</option>
            {(actions.data ?? []).map((each) => (
              <option key={each.name} value={each.name}>
                {each.name}
              </option>
            ))}
          </select>
        </div>
        <Button type="submit" size="sm" disabled={action === ""}>
          Add the action
        </Button>
      </form>
      <div className="flex flex-wrap gap-1">
        <Button
          size="sm"
          variant="outline"
          onClick={() => edit.add({ kind: "if" })}
        >
          Add a condition
        </Button>
        <Button
          size="sm"
          variant="outline"
          onClick={() => edit.add({ kind: "wait" })}
        >
          Add a wait
        </Button>
        <Button
          size="sm"
          variant="ghost"
          onClick={() => edit.startAdding(null)}
        >
          Cancel
        </Button>
      </div>
    </section>
  );
};
