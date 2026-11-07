// A form for one action, with a control per field its input takes (P1.21).
import { useQuery } from "@tanstack/react-query";
import { Button } from "@workspace/ui/components/button";
import { Input } from "@workspace/ui/components/input";
import { Label } from "@workspace/ui/components/label";
import { useState } from "react";

import { ApiCallError, runQuery } from "../lib/api.ts";
import type { SystemDescription } from "../lib/api.ts";
import type { FormField, FormValues } from "../lib/forms.ts";
import { findObject, titleOf } from "../lib/records.ts";
import type { ListPage } from "../lib/records.ts";

const selectClass =
  "h-8 w-full rounded-2xl border border-input bg-transparent px-2 text-sm outline-none focus-visible:border-ring";

/** A select of the target's records, or a plain id input if it has no list. */
const RefSelect = ({
  field,
  value,
  onChange,
  description,
}: {
  field: FormField;
  value: string;
  onChange: (value: string) => void;
  description: SystemDescription | undefined;
}) => {
  const target = field.target ?? "";
  const can = (name: string) =>
    description?.queries.some((query) => query.name === name) ?? false;
  // Refs to actors list people (P1b.04's `actor.list`); refs to objects use
  // the object's own `.list`, whose output differs.
  const isActor = target === "actor";
  const listable = isActor
    ? can("actor.list")
    : findObject(description, target) !== undefined && can(`${target}.list`);
  const options = useQuery({
    queryKey: ["options", target],
    queryFn: async (): Promise<Record<string, unknown>[]> => {
      if (isActor) {
        const { entries } = await runQuery<{
          entries: Record<string, unknown>[];
        }>("actor.list", { kind: "staff", status: "active", limit: 200 });
        return entries;
      }
      const { records } = await runQuery<ListPage>(`${target}.list`, {
        limit: 100,
      });
      return records;
    },
    enabled: listable,
  });
  if (!listable) {
    return (
      <Input
        id={field.key}
        value={value}
        placeholder="Id"
        onChange={(event) => onChange(event.target.value)}
      />
    );
  }
  const object = findObject(description, target);
  return (
    <select
      id={field.key}
      className={selectClass}
      value={value}
      required={field.required}
      onChange={(event) => onChange(event.target.value)}
    >
      <option value="">{options.isPending ? "Loading…" : "None"}</option>
      {options.data?.map((record) => (
        <option key={String(record.id)} value={String(record.id)}>
          {titleOf(record, object)}
        </option>
      ))}
    </select>
  );
};

const inputTypes: Record<string, string> = {
  number: "number",
  money: "number",
  date: "date",
};

/** What went wrong, with each invalid field's message. */
export const ErrorMessage = ({ error }: { error: Error | null }) => {
  if (!error) {
    return null;
  }
  const issues =
    error instanceof ApiCallError && "issues" in error.error
      ? (error.error.issues as { path: (string | number)[]; message: string }[])
      : [];
  return (
    <div role="alert" className="text-sm text-destructive">
      <p>{error.message}</p>
      {issues.length > 0 && (
        <ul className="list-disc pl-5">
          {issues.map((issue) => (
            <li key={`${issue.path.join(".")}:${issue.message}`}>
              {issue.path.join(".") || "input"}: {issue.message}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
};

export const RecordForm = ({
  fields,
  initial,
  description,
  submitLabel,
  pending,
  error,
  onSubmit,
  onCancel,
}: {
  fields: FormField[];
  initial: FormValues;
  description: SystemDescription | undefined;
  submitLabel: string;
  pending: boolean;
  error: Error | null;
  onSubmit: (values: FormValues) => void;
  onCancel?: () => void;
}) => {
  const [values, setValues] = useState(initial);
  const set = (key: string, value: string | boolean) =>
    setValues((previous) => ({ ...previous, [key]: value }));

  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    onSubmit(values);
  };

  return (
    <form onSubmit={submit} className="flex max-w-lg flex-col gap-4">
      {fields.map((field) => {
        const value = values[field.key];
        if (field.type === "boolean") {
          return (
            <label key={field.key} className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={value === true}
                onChange={(event) => set(field.key, event.target.checked)}
              />
              {field.label}
            </label>
          );
        }
        return (
          <div key={field.key} className="flex flex-col gap-1.5">
            <Label htmlFor={field.key}>
              {field.label}
              {field.required && " *"}
            </Label>
            {field.type === "ref" ? (
              <RefSelect
                field={field}
                value={String(value ?? "")}
                onChange={(next) => set(field.key, next)}
                description={description}
              />
            ) : (
              <Input
                id={field.key}
                type={inputTypes[field.type] ?? "text"}
                step={field.type === "money" ? "0.01" : undefined}
                value={String(value ?? "")}
                required={field.required}
                onChange={(event) => set(field.key, event.target.value)}
              />
            )}
          </div>
        );
      })}
      <ErrorMessage error={error} />
      <div className="flex gap-2">
        <Button type="submit" disabled={pending}>
          {pending ? "Saving…" : submitLabel}
        </Button>
        {onCancel && (
          <Button type="button" variant="outline" onClick={onCancel}>
            Cancel
          </Button>
        )}
      </div>
    </form>
  );
};
