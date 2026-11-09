// Config editors for a draft (P2.10): choice lists and roles as forms, each
// built from what the config type allows. A choice list's own columns come
// from its JSON Schema in system.describe; a role's grid from the objects
// and actions the system has. Saving sends the value, which the server
// writes as YAML (draft.save) and checks against the running system.
import { Button } from "@workspace/ui/components/button";
import { Input } from "@workspace/ui/components/input";
import { ArrowDown, ArrowUp, X } from "lucide-react";
import { useState } from "react";
import type { ReactNode } from "react";

import type { SystemDescription } from "../lib/api.ts";
import { optionMarks } from "../lib/choice-lists.ts";
import { humanise } from "../lib/forms.ts";
import {
  fieldListText,
  jobsOf,
  objectJobs,
  objectName,
  roleOf,
  workflowsOf,
} from "../lib/roles.ts";
import type { FieldList, ObjectRules } from "../lib/roles.ts";

type Value = Record<string, unknown>;

export interface EditorProps {
  value: Value;
  description: SystemDescription | undefined;
  saving: boolean;
  onSave: (value: Value) => void;
  /** The save button's label; "Save to draft" by default. */
  saveLabel?: string;
  /**
   * A choice list's live options, to mark the rows that differ from them.
   * Left out, no row is marked.
   */
  live?: Value[];
}

interface ColumnSchema {
  type?: string;
  enum?: unknown[];
}

interface ColumnsSchema {
  properties?: Record<string, ColumnSchema>;
  required?: string[];
}

/** The list's own columns, from a choice field that uses it. */
export const columnsOf = (
  description: SystemDescription | undefined,
  list: string
): ColumnsSchema | null => {
  for (const object of description?.objects ?? []) {
    for (const field of object.fields) {
      if (field.list === list && field.optionColumns) {
        return field.optionColumns as ColumnsSchema;
      }
    }
  }
  return null;
};

const cell = "px-2 py-1.5 align-middle";

const ColumnInput = ({
  name,
  schema,
  value,
  onChange,
}: {
  name: string;
  schema: ColumnSchema;
  value: unknown;
  onChange: (value: unknown) => void;
}) => {
  if (schema.enum) {
    return (
      <select
        aria-label={humanise(name)}
        className="h-8 rounded-2xl border bg-background px-2 text-sm"
        value={typeof value === "string" ? value : ""}
        onChange={(event) => onChange(event.target.value || undefined)}
      >
        <option value="">—</option>
        {schema.enum.map((option) => (
          <option key={String(option)} value={String(option)}>
            {String(option)}
          </option>
        ))}
      </select>
    );
  }
  if (schema.type === "boolean") {
    return (
      <input
        type="checkbox"
        aria-label={humanise(name)}
        checked={value === true}
        onChange={(event) => onChange(event.target.checked)}
      />
    );
  }
  const numeric = schema.type === "number" || schema.type === "integer";
  return (
    <Input
      aria-label={humanise(name)}
      className="h-8"
      type={numeric ? "number" : "text"}
      value={value === undefined || value === null ? "" : String(value)}
      onChange={(event) => {
        const raw = event.target.value;
        if (raw === "") {
          onChange(undefined);
          return;
        }
        onChange(numeric ? Number(raw) : raw);
      }}
    />
  );
};

const SaveBar = ({
  saving,
  dirty,
  onSave,
  label = "Save to draft",
  children,
}: {
  saving: boolean;
  dirty: boolean;
  onSave: () => void;
  label?: string;
  children?: ReactNode;
}) => (
  <div className="flex flex-wrap items-center gap-2">
    <Button disabled={saving || !dirty} onClick={onSave}>
      {saving ? "Saving…" : label}
    </Button>
    {children}
    {dirty ? (
      <span className="text-sm text-muted-foreground">Unsaved changes</span>
    ) : null}
  </div>
);

/** "New" or "Edited": how a row differs from the live list. */
export const OptionBadge = ({ mark }: { mark: "new" | "changed" }) => (
  <span className="rounded-full bg-amber-500/15 px-1.5 py-0.5 text-xs text-amber-700 dark:text-amber-300">
    {mark === "new" ? "New" : "Edited"}
  </span>
);

/** Without undefined fields, so an emptied column leaves the file. */
const tidy = (option: Value): Value =>
  Object.fromEntries(
    Object.entries(option).filter(
      ([key, value]) =>
        value !== undefined &&
        !(key === "archived" && value === false) &&
        !(key === "description" && value === "")
    )
  );

/**
 * A choice list's options: add, rename, describe, reorder and archive them.
 * An option that has been saved can't be removed, since records may hold
 * its key; archive it instead.
 */
export const ChoiceListEditor = ({
  value,
  description,
  saving,
  onSave,
  saveLabel,
  live,
}: EditorProps) => {
  const listKey = String(value.key ?? "");
  const saved = Array.isArray(value.options) ? (value.options as Value[]) : [];
  const savedKeys = new Set(saved.map((option) => String(option.key)));
  const [options, setOptions] = useState<Value[]>(saved);
  const schema = columnsOf(description, listKey);
  // Without a schema (the caller can't see a field that uses the list), the
  // columns the options already have are edited as text.
  const columns: [string, ColumnSchema][] = schema
    ? Object.entries(schema.properties ?? {})
    : [
        ...new Set(
          saved.flatMap((option) =>
            Object.keys(option).filter(
              (key) =>
                !["key", "label", "description", "archived"].includes(key)
            )
          )
        ),
      ].map((key) => [key, { type: "string" }]);
  const dirty = JSON.stringify(options) !== JSON.stringify(saved);
  const marks = live ? optionMarks(options.map(tidy), live) : new Map();
  const set = (index: number, key: string, next: unknown) =>
    setOptions((previous) =>
      previous.map((option, at) =>
        at === index ? { ...option, [key]: next } : option
      )
    );
  const move = (index: number, by: number) =>
    setOptions((previous) => {
      const next = [...previous];
      const [moved] = next.splice(index, 1);
      if (moved) {
        next.splice(index + by, 0, moved);
      }
      return next;
    });
  return (
    <div className="flex flex-col gap-3">
      <div className="overflow-x-auto rounded-2xl border">
        <table className="w-full text-left text-sm">
          <thead className="border-b bg-muted/50">
            <tr>
              <th className={`${cell} font-medium`}>Key</th>
              <th className={`${cell} font-medium`}>Label</th>
              <th className={`${cell} font-medium`}>Description</th>
              {columns.map(([name]) => (
                <th key={name} className={`${cell} font-medium`}>
                  {humanise(name)}
                </th>
              ))}
              <th className={`${cell} font-medium`}>Archived</th>
              <th className={cell}>
                <span className="sr-only">Order</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {options.map((option, index) => {
              const isSaved = savedKeys.has(String(option.key));
              const mark = marks.get(String(option.key));
              return (
                // Keys can be edited on new rows, so the row's place is its key.
                // oxlint-disable-next-line react/no-array-index-key
                <tr
                  key={index}
                  className={`border-b last:border-0 ${mark ? "bg-amber-500/5" : ""}`}
                >
                  <td className={cell}>
                    {isSaved ? (
                      <span className="flex items-center gap-2">
                        <span className="font-mono text-xs">
                          {String(option.key)}
                        </span>
                        {mark ? <OptionBadge mark={mark} /> : null}
                      </span>
                    ) : (
                      <Input
                        aria-label="Key"
                        className="h-8 font-mono"
                        placeholder="new-key"
                        value={String(option.key ?? "")}
                        onChange={(event) =>
                          set(index, "key", event.target.value)
                        }
                      />
                    )}
                  </td>
                  <td className={cell}>
                    <Input
                      aria-label="Label"
                      className="h-8"
                      value={String(option.label ?? "")}
                      onChange={(event) =>
                        set(index, "label", event.target.value)
                      }
                    />
                  </td>
                  <td className={cell}>
                    <Input
                      aria-label="Description"
                      className="h-8"
                      value={String(option.description ?? "")}
                      onChange={(event) =>
                        set(index, "description", event.target.value)
                      }
                    />
                  </td>
                  {columns.map(([name, column]) => (
                    <td key={name} className={cell}>
                      <ColumnInput
                        name={name}
                        schema={column}
                        value={option[name]}
                        onChange={(next) => set(index, name, next)}
                      />
                    </td>
                  ))}
                  <td className={`${cell} text-center`}>
                    <input
                      type="checkbox"
                      aria-label="Archived"
                      checked={option.archived === true}
                      onChange={(event) =>
                        set(index, "archived", event.target.checked)
                      }
                    />
                  </td>
                  <td className={`${cell} whitespace-nowrap`}>
                    <Button
                      size="icon-sm"
                      variant="ghost"
                      aria-label="Move up"
                      disabled={index === 0}
                      onClick={() => move(index, -1)}
                    >
                      <ArrowUp />
                    </Button>
                    <Button
                      size="icon-sm"
                      variant="ghost"
                      aria-label="Move down"
                      disabled={index === options.length - 1}
                      onClick={() => move(index, 1)}
                    >
                      <ArrowDown />
                    </Button>
                    {isSaved ? null : (
                      <Button
                        size="icon-sm"
                        variant="ghost"
                        aria-label="Remove"
                        onClick={() =>
                          setOptions((previous) =>
                            previous.filter((_, at) => at !== index)
                          )
                        }
                      >
                        <X />
                      </Button>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <SaveBar
        saving={saving}
        dirty={dirty}
        label={saveLabel}
        onSave={() => onSave({ ...value, options: options.map(tidy) })}
      >
        <Button
          variant="outline"
          onClick={() =>
            setOptions((previous) => [...previous, { key: "", label: "" }])
          }
        >
          Add option
        </Button>
      </SaveBar>
    </div>
  );
};

const listText = (list: string[]) => list.join(", ");

const listFrom = (text: string) =>
  text
    .split(",")
    .map((each) => each.trim())
    .filter((each) => each !== "");

/** A rule's file shape: `*` when it has every endpoint, empty lists left out. */
const tidyRules = (rules: ObjectRules): Value => {
  const jobs = jobsOf(rules);
  const out: Value = {
    endpoints: objectJobs.every((job) => jobs.includes(job))
      ? "*"
      : objectJobs.filter((job) => jobs.includes(job)),
    rows: rules.rows,
  };
  for (const side of ["read", "write"] as const) {
    const list = rules[side];
    if (list?.only || (list?.except && list.except.length > 0)) {
      out[side] = list;
    }
  }
  return out;
};

const roleValue = (
  value: Value,
  label: string,
  objects: Record<string, ObjectRules>,
  workflows: string[]
): Value => {
  const {
    permissions: _old,
    objects: _objects,
    workflows: _w,
    ...rest
  } = value;
  const kept = Object.entries(objects).filter(
    ([, rules]) => jobsOf(rules).length > 0
  );
  return {
    ...rest,
    label,
    ...(kept.length > 0
      ? {
          objects: Object.fromEntries(
            kept.map(([name, rules]) => [name, tidyRules(rules)])
          ),
        }
      : {}),
    ...(workflows.length > 0
      ? { workflows: workflows.includes("*") ? "*" : workflows }
      : {}),
  };
};

/** One side's field rule: an `except` list typed in, or an `only` list shown. */
const FieldRuleInput = ({
  label,
  list,
  onChange,
}: {
  label: string;
  list: FieldList | undefined;
  onChange: (list: FieldList | undefined) => void;
}) =>
  list?.only ? (
    <span className="text-xs text-muted-foreground">
      {fieldListText(list)} (set in the file)
    </span>
  ) : (
    <Input
      aria-label={label}
      className="h-8 min-w-32 font-mono"
      placeholder="none"
      value={listText(list?.except ?? [])}
      onChange={(event) => {
        const except = listFrom(event.target.value);
        onChange(except.length > 0 ? { except } : undefined);
      }}
    />
  );

/**
 * A role (P2.14): its label; per object the endpoints it may call, whose
 * rows, and the fields it can't see or can't change; then the workflows it
 * may call. Hand-written actions are granted under workflows until they
 * become workflows.
 */
export const RoleEditor = ({
  value,
  description,
  saving,
  onSave,
  saveLabel,
}: EditorProps) => {
  const saved = roleOf(value);
  const [label, setLabel] = useState(String(value.label ?? ""));
  const [objects, setObjects] = useState<Record<string, ObjectRules>>(
    saved.objects ?? {}
  );
  const [workflows, setWorkflows] = useState<string[]>(workflowsOf(saved));
  const [adding, setAdding] = useState("");
  const described = description?.objects ?? [];
  const objectNames = [
    "*",
    ...new Set([
      ...described.map((object) => object.name),
      ...Object.keys(objects).filter((name) => name !== "*"),
    ]),
  ];
  const endpointNames = new Set(
    described.flatMap((object) =>
      object.endpoints.map((endpoint) => endpoint.name)
    )
  );
  const known = [
    ...(description?.actions ?? []),
    ...(description?.queries ?? []),
  ]
    .map((definition) => definition.name)
    .filter((name) => !endpointNames.has(name))
    .toSorted();
  const next = roleValue(value, label, objects, workflows);
  const dirty =
    JSON.stringify(next) !==
    JSON.stringify(
      roleValue(
        value,
        String(value.label ?? ""),
        saved.objects ?? {},
        workflowsOf(saved)
      )
    );
  const change = (object: string, patch: Partial<ObjectRules>) =>
    setObjects((previous) => ({
      ...previous,
      [object]: {
        ...(previous[object] ?? { endpoints: [], rows: "all" }),
        ...patch,
      },
    }));
  const toggle = (object: string, job: string, on: boolean) => {
    const jobs = jobsOf(objects[object]);
    change(object, {
      endpoints: on
        ? objectJobs.filter((each) => each === job || jobs.includes(each))
        : jobs.filter((each) => each !== job),
    });
  };
  const addWorkflow = () => {
    const name = adding.trim();
    if (name !== "" && !workflows.includes(name)) {
      setWorkflows((previous) => [...previous, name]);
    }
    setAdding("");
  };
  return (
    <div className="flex flex-col gap-4">
      <label className="flex max-w-sm flex-col gap-1.5 text-sm">
        <span className="font-medium">Label</span>
        <Input
          value={label}
          onChange={(event) => setLabel(event.target.value)}
        />
      </label>
      <div className="overflow-x-auto rounded-2xl border">
        <table className="w-full text-left text-sm">
          <thead className="border-b bg-muted/50">
            <tr>
              <th className={`${cell} font-medium`}>Object</th>
              {objectJobs.map((job) => (
                <th
                  key={job}
                  className={`${cell} text-center font-medium capitalize`}
                >
                  {job}
                </th>
              ))}
              <th className={`${cell} font-medium`}>Rows</th>
              <th className={`${cell} font-medium`}>Hidden</th>
              <th className={`${cell} font-medium`}>Read-only</th>
            </tr>
          </thead>
          <tbody>
            {objectNames.map((object) => {
              const rules = objects[object];
              const jobs = jobsOf(rules);
              const owned =
                object === "*" ||
                described.some(
                  (each) => each.name === object && each.owner !== null
                );
              return (
                <tr key={object} className="border-b last:border-0">
                  <td className={cell}>{objectName(object)}</td>
                  {objectJobs.map((job) => (
                    <td key={job} className={`${cell} text-center`}>
                      <input
                        type="checkbox"
                        aria-label={`${job} ${object}`}
                        checked={jobs.includes(job)}
                        onChange={(event) =>
                          toggle(object, job, event.target.checked)
                        }
                      />
                    </td>
                  ))}
                  <td className={cell}>
                    <select
                      aria-label={`Rows of ${object}`}
                      className="h-8 rounded-md border bg-transparent px-2"
                      disabled={jobs.length === 0}
                      value={rules?.rows ?? "all"}
                      onChange={(event) =>
                        change(object, {
                          rows: event.target.value === "own" ? "own" : "all",
                        })
                      }
                    >
                      <option value="all">All</option>
                      {owned || rules?.rows === "own" ? (
                        <option value="own">Own</option>
                      ) : null}
                    </select>
                  </td>
                  <td className={cell}>
                    <FieldRuleInput
                      label={`Fields of ${object} it can't see`}
                      list={rules?.read}
                      onChange={(read) => change(object, { read })}
                    />
                  </td>
                  <td className={cell}>
                    <FieldRuleInput
                      label={`Fields of ${object} it can't change`}
                      list={rules?.write}
                      onChange={(write) => change(object, { write })}
                    />
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <fieldset className="flex flex-col gap-2">
        <legend className="mb-2 text-sm font-medium">
          Workflows it can call
        </legend>
        {workflows.length === 0 ? (
          <p className="text-sm text-muted-foreground">None.</p>
        ) : (
          <ul className="flex flex-wrap gap-1">
            {workflows.map((name) => (
              <li
                key={name}
                className="inline-flex items-center gap-1 rounded-full border px-2.5 py-0.5 font-mono text-xs"
              >
                {name === "*" ? "every workflow" : name}
                <button
                  type="button"
                  aria-label={`Remove ${name}`}
                  className="text-muted-foreground hover:text-foreground"
                  onClick={() =>
                    setWorkflows((previous) =>
                      previous.filter((each) => each !== name)
                    )
                  }
                >
                  <X className="size-3.5" />
                </button>
              </li>
            ))}
          </ul>
        )}
        <div className="flex max-w-md gap-2">
          <Input
            aria-label="Workflow to add"
            className="h-8 font-mono"
            list="role-editor-workflows"
            placeholder="deal.moveStage"
            value={adding}
            onChange={(event) => setAdding(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                addWorkflow();
              }
            }}
          />
          <datalist id="role-editor-workflows">
            {known.map((name) => (
              <option key={name} value={name}>
                {name}
              </option>
            ))}
          </datalist>
          <Button size="sm" variant="outline" onClick={addWorkflow}>
            Add
          </Button>
        </div>
      </fieldset>
      <SaveBar
        saving={saving}
        dirty={dirty}
        label={saveLabel}
        onSave={() => onSave(next)}
      />
    </div>
  );
};

/** Whether a config type has an editor yet. */
export const hasEditor = (type: string) =>
  type === "choices" || type === "roles";

/** The editor for a config file's type. */
export const ConfigEditor = ({
  type,
  ...props
}: EditorProps & { type: string }) => {
  if (type === "choices") {
    return <ChoiceListEditor {...props} />;
  }
  return type === "roles" ? <RoleEditor {...props} /> : null;
};
