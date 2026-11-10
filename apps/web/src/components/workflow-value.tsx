// One control for every value a step is given: a fixed value typed here,
// or a path picked from what the step may read. The picker offers only
// what the check's scopes allow at that step.
import { useQuery } from "@tanstack/react-query";
import { Button } from "@workspace/ui/components/button";
import { Input } from "@workspace/ui/components/input";
import { Label } from "@workspace/ui/components/label";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@workspace/ui/components/popover";
import type { Source, Step, WorkflowCheck } from "@workspace/workflows";
import { ChevronDown } from "lucide-react";
import { useId, useState } from "react";

import { readWorkflow } from "../lib/api.ts";
import { actionListKey } from "../lib/workflow-events.ts";
import type { ActionListItem } from "../lib/workflow-events.ts";
import {
  fixedChoices,
  fixedText,
  fixedValue,
  inputSchema,
  pickerGroups,
  schemaType,
  searched,
  splitByFit,
} from "../lib/workflow-picker.ts";
import type { Fixed, PickerOption } from "../lib/workflow-picker.ts";
import { setStepValue, stepValues } from "../lib/workflow-steps.ts";
import { rowTitle } from "../lib/workflow-tree.ts";
import type { TreeRow } from "../lib/workflow-tree.ts";
import { pathWords, titleOf } from "../lib/workflow-words.ts";
import type { StepEditing } from "./workflow-step-edit.tsx";

type Scopes = WorkflowCheck["scopes"];

const fieldClass = "h-8 w-full rounded-xl border bg-transparent px-2 text-sm";

const Options = ({
  options,
  current,
  onPick,
}: {
  options: readonly PickerOption[];
  current: string | undefined;
  onPick: (path: string) => void;
}) => (
  <ul className="flex flex-col">
    {options.map((option) => (
      <li key={option.path}>
        <button
          type="button"
          aria-current={option.path === current ? "true" : undefined}
          onClick={() => onPick(option.path)}
          className="flex w-full flex-col rounded-lg px-2 py-1 text-left hover:bg-muted focus-visible:bg-muted focus-visible:outline-none aria-[current]:bg-muted"
        >
          <span>{option.words}</span>
          <span className="font-mono text-xs text-muted-foreground">
            {option.path}
          </span>
        </button>
      </li>
    ))}
  </ul>
);

/** Everything the step may read, to pick one path from. */
const DataPicker = ({
  label,
  path,
  scopes,
  stepPath,
  target,
  onPick,
}: {
  label: string;
  path: string | undefined;
  scopes: Scopes | undefined;
  stepPath: string;
  target: unknown;
  onPick: (path: string) => void;
}) => {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const split = splitByFit(
    searched(pickerGroups(scopes, stepPath, target), search)
  );
  const pick = (picked: string) => {
    setOpen(false);
    setSearch("");
    onPick(picked);
  };
  const empty = split.fits.length === 0 && split.rest.length === 0;
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        render={
          <Button
            variant="outline"
            size="sm"
            className="w-full justify-between"
            aria-label={`${label}: ${path ? pathWords(path) : "choose data"}`}
          />
        }
      >
        <span className="truncate">
          {path ? pathWords(path) : "Choose data"}
        </span>
        <ChevronDown aria-hidden />
      </PopoverTrigger>
      <PopoverContent align="start" className="w-80 gap-2 p-2">
        <Input
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          placeholder="Search"
          aria-label="Search the data"
        />
        <div className="flex max-h-72 flex-col gap-2 overflow-y-auto">
          {split.fits.map((group) => (
            <section key={group.title} aria-label={group.title}>
              <h4 className="px-2 py-1 text-xs text-muted-foreground">
                {group.title}
              </h4>
              <Options options={group.options} current={path} onPick={pick} />
            </section>
          ))}
          {split.rest.length > 0 ? (
            <section aria-label="May not fit" className="border-t pt-2">
              <h4 className="px-2 py-1 text-xs text-muted-foreground">
                May not fit: this takes {schemaType(target)}
              </h4>
              <Options options={split.rest} current={path} onPick={pick} />
            </section>
          ) : null}
          {empty ? (
            <p className="px-2 py-1 text-muted-foreground">
              {search === ""
                ? "Nothing can be read here yet."
                : "Nothing matches."}
            </p>
          ) : null}
        </div>
      </PopoverContent>
    </Popover>
  );
};

/** A fixed value: a list when the input names its options, else a field. */
const FixedField = ({
  id,
  value,
  target,
  onChange,
}: {
  id: string;
  value: unknown;
  target: unknown;
  onChange: (value: Fixed) => void;
}) => {
  const type = schemaType(target);
  const [text, setText] = useState(fixedText(value));
  const choices = type === "boolean" ? ["true", "false"] : fixedChoices(target);
  if (choices) {
    return (
      <select
        id={id}
        value={fixedText(value)}
        onChange={(event) => onChange(fixedValue(event.target.value, type))}
        className={fieldClass}
      >
        <option value="" disabled>
          Choose one
        </option>
        {choices.map((choice) => (
          <option key={choice} value={choice}>
            {choice}
          </option>
        ))}
      </select>
    );
  }
  // The file changes when the field is left, so one edit is one step to undo.
  const commit = () => {
    if (text !== fixedText(value)) {
      onChange(fixedValue(text, type));
    }
  };
  return (
    <Input
      id={id}
      value={text}
      inputMode={type === "number" ? "decimal" : undefined}
      onChange={(event) => setText(event.target.value)}
      onBlur={commit}
      onKeyDown={(event) => {
        if (event.key === "Enter") {
          commit();
        }
      }}
    />
  );
};

type Mode = "fixed" | "data";

const ModeSwitch = ({
  label,
  mode,
  onMode,
}: {
  label: string;
  mode: Mode;
  onMode: (mode: Mode) => void;
}) => (
  <fieldset className="flex gap-1">
    <legend className="sr-only">Where {label} comes from</legend>
    <Button
      size="xs"
      variant={mode === "fixed" ? "secondary" : "ghost"}
      aria-pressed={mode === "fixed"}
      onClick={() => onMode("fixed")}
    >
      Fixed value
    </Button>
    <Button
      size="xs"
      variant={mode === "data" ? "secondary" : "ghost"}
      aria-pressed={mode === "data"}
      onClick={() => onMode("data")}
    >
      From data
    </Button>
  </fieldset>
);

export interface ValueInputProps {
  name: string;
  source: Source;
  /** The JSON Schema of the input this fills, when the action says. */
  target: unknown;
  /** True when the action takes this only as a fixed value. */
  fixed: boolean;
  scopes: Scopes | undefined;
  stepPath: string;
  onChange: (source: Source) => void;
}

/** One value: fixed, or from data. */
export const ValueInput = (props: ValueInputProps) => {
  const id = useId();
  const label = titleOf(props.name);
  const { source } = props;
  const [chosen, setChosen] = useState<Mode>(
    "from" in source ? "data" : "fixed"
  );
  const mode = props.fixed ? "fixed" : chosen;
  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-center justify-between gap-2">
        <Label htmlFor={id}>{label}</Label>
        {props.fixed ? null : (
          <ModeSwitch label={label} mode={mode} onMode={setChosen} />
        )}
      </div>
      {mode === "fixed" ? (
        <FixedField
          // A value set from elsewhere, by undo say, starts the field afresh.
          key={fixedText("value" in source ? source.value : "")}
          id={id}
          value={"value" in source ? source.value : ""}
          target={props.target}
          onChange={(value) => props.onChange({ value })}
        />
      ) : (
        <DataPicker
          label={label}
          path={"from" in source ? source.from : undefined}
          scopes={props.scopes}
          stepPath={props.stepPath}
          target={props.target}
          onPick={(from) => props.onChange({ from })}
        />
      )}
      {props.fixed ? (
        <p className="text-xs text-muted-foreground">
          The action needs this set in the workflow itself, so it can’t come
          from data.
        </p>
      ) : null}
    </div>
  );
};

const fetchActions = async () => {
  // `action_list` takes no input: the actions are the system's, not a draft's.
  const result = await readWorkflow<{ actions: ActionListItem[] }>(
    actionListKey
  );
  return result.output.actions;
};

const actionOf = (step: Step) => ("action" in step ? step.action : null);

/** The selected step's values, each to set as a fixed value or from data. */
export const StepValues = ({
  row,
  editing,
  scopes,
}: {
  row: TreeRow;
  editing: StepEditing;
  scopes: Scopes | undefined;
}) => {
  const name = actionOf(row.step);
  const actions = useQuery({
    queryKey: [actionListKey],
    queryFn: fetchActions,
    enabled: name !== null,
  });
  const values = Object.entries(stepValues(row.step) ?? {});
  if (values.length === 0) {
    return null;
  }
  const action = actions.data?.find((each) => each.name === name);
  return (
    <section
      aria-label={`What ${rowTitle(row)} is given`}
      className="flex flex-col gap-3 rounded-2xl border p-3"
    >
      <h3 className="text-sm font-medium">
        {"output" in row.step ? "What it gives back" : "What it is given"}
      </h3>
      {values.map(([key, source]) => (
        <ValueInput
          // Another step with an input of the same name starts afresh.
          key={`${row.path}.${key}`}
          name={key}
          source={source}
          target={inputSchema(action?.input, key)}
          fixed={action?.fixed_inputs?.includes(key) ?? false}
          scopes={scopes}
          stepPath={row.path}
          onChange={(next) =>
            editing.onChange(
              setStepValue(editing.definition, row.path, key, next)
            )
          }
        />
      ))}
    </section>
  );
};
