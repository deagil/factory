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

const verbs = ["view", "create", "update", "archive"];

interface ObjectLine {
  object: string;
  can: string[];
  scope: string;
}

interface ActionLine {
  action: string;
  scope: string;
}

const linesOf = (value: Value) => {
  const permissions = Array.isArray(value.permissions)
    ? (value.permissions as Value[])
    : [];
  return {
    objects: permissions.filter(
      (line): line is ObjectLine & Value => typeof line.object === "string"
    ),
    actions: permissions.filter(
      (line): line is ActionLine & Value => typeof line.action === "string"
    ),
  };
};

/**
 * A role: its label, what it can do to each object, and the actions it can
 * run. Every line's scope is `all`, the only scope there is so far.
 */
export const RoleEditor = ({
  value,
  description,
  saving,
  onSave,
  saveLabel,
}: EditorProps) => {
  const saved = linesOf(value);
  const [label, setLabel] = useState(String(value.label ?? ""));
  const [objects, setObjects] = useState<ObjectLine[]>(saved.objects);
  const [actions, setActions] = useState<string[]>(
    saved.actions.map((line) => line.action)
  );
  const [adding, setAdding] = useState("");
  const objectNames = [
    ...new Set([
      ...(description?.objects ?? []).map((object) => object.name),
      ...objects.map((line) => line.object),
    ]),
  ];
  const known = (description?.actions ?? [])
    .map((action) => action.name)
    .toSorted();
  const next = {
    ...value,
    label,
    permissions: [
      ...objects.filter((line) => line.can.length > 0),
      ...actions.map((action) => ({ action, scope: "all" })),
    ],
  };
  const dirty =
    JSON.stringify(next) !==
    JSON.stringify({
      ...value,
      label: value.label,
      permissions: [...saved.objects, ...saved.actions],
    });
  const toggle = (object: string, verb: string, on: boolean) =>
    setObjects((previous) => {
      const line = previous.find((each) => each.object === object) ?? {
        object,
        can: [],
        scope: "all",
      };
      const can = on
        ? verbs.filter((each) => each === verb || line.can.includes(each))
        : line.can.filter((each) => each !== verb);
      return previous.some((each) => each.object === object)
        ? previous.map((each) =>
            each.object === object ? { ...each, can } : each
          )
        : [...previous, { ...line, can }];
    });
  const addAction = () => {
    const name = adding.trim();
    if (name !== "" && !actions.includes(name)) {
      setActions((previous) => [...previous, name]);
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
              {verbs.map((verb) => (
                <th
                  key={verb}
                  className={`${cell} text-center font-medium capitalize`}
                >
                  {verb}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {["*", ...objectNames.filter((name) => name !== "*")].map(
              (object) => {
                const can =
                  objects.find((line) => line.object === object)?.can ?? [];
                return (
                  <tr key={object} className="border-b last:border-0">
                    <td className={cell}>
                      {object === "*" ? "Every object" : object}
                    </td>
                    {verbs.map((verb) => (
                      <td key={verb} className={`${cell} text-center`}>
                        <input
                          type="checkbox"
                          aria-label={`${verb} ${object}`}
                          checked={can.includes(verb)}
                          onChange={(event) =>
                            toggle(object, verb, event.target.checked)
                          }
                        />
                      </td>
                    ))}
                  </tr>
                );
              }
            )}
          </tbody>
        </table>
      </div>
      <fieldset className="flex flex-col gap-2">
        <legend className="mb-2 text-sm font-medium">Actions it can run</legend>
        {actions.length === 0 ? (
          <p className="text-sm text-muted-foreground">None.</p>
        ) : (
          <ul className="flex flex-wrap gap-1">
            {actions.map((action) => (
              <li
                key={action}
                className="inline-flex items-center gap-1 rounded-full border px-2.5 py-0.5 font-mono text-xs"
              >
                {action === "*" ? "every action" : action}
                <button
                  type="button"
                  aria-label={`Remove ${action}`}
                  className="text-muted-foreground hover:text-foreground"
                  onClick={() =>
                    setActions((previous) =>
                      previous.filter((each) => each !== action)
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
            aria-label="Action to add"
            className="h-8 font-mono"
            list="role-editor-actions"
            placeholder="deal.moveStage"
            value={adding}
            onChange={(event) => setAdding(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                addAction();
              }
            }}
          />
          <datalist id="role-editor-actions">
            {known.map((name) => (
              <option key={name} value={name}>
                {name}
              </option>
            ))}
          </datalist>
          <Button size="sm" variant="outline" onClick={addAction}>
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
