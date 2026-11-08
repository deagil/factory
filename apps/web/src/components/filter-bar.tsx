// Adds and removes list filters. Fields and operators come from
// system.describe; the filters live in the URL (P1.20).
import { Button } from "@workspace/ui/components/button";
import { Input } from "@workspace/ui/components/input";
import { useState } from "react";

import { humanise } from "../lib/forms.ts";
import { displayValue, filterValue, withoutFilter } from "../lib/records.ts";
import type { FieldDescription, Filter } from "../lib/records.ts";

const selectClass =
  "h-8 rounded-2xl border border-input bg-transparent px-2 text-sm outline-none focus-visible:border-ring";

const words: Record<string, string> = {
  eq: "is",
  ne: "is not",
  in: "is one of",
  contains: "contains",
  startsWith: "starts with",
  gt: "is more than",
  gte: "is at least",
  lt: "is less than",
  lte: "is at most",
  isNull: "is empty",
  where: "has",
};

/** A choice list's column values, such as `category open`. */
const columnsText = (match: unknown) =>
  Object.entries(match as Record<string, unknown>)
    .map(([name, value]) => `${humanise(name).toLowerCase()} ${String(value)}`)
    .join(" and ");

/**
 * Each distinct value of each of the list's own columns among its live
 * options, as `where` filters: `{ category: "open" }` and so on.
 */
const columnMatches = (field: FieldDescription) => {
  const seen = new Map<string, Record<string, unknown>>();
  for (const option of field.options ?? []) {
    if (option.archived) {
      continue;
    }
    for (const [name, value] of Object.entries(option.columns)) {
      const match = { [name]: value };
      seen.set(JSON.stringify(match), match);
    }
  }
  return [...seen.entries()];
};

const shownFilterValue = (
  field: FieldDescription | undefined,
  op: string,
  value: unknown
) => {
  if (op === "where") {
    return columnsText(value);
  }
  if (field?.type !== "choice") {
    return JSON.stringify(value);
  }
  return displayValue(field, { [field.key]: value }, {}, undefined);
};

/** The value control for one field and operator. */
const FilterValue = ({
  field,
  operator,
  value,
  onChange,
}: {
  field: FieldDescription | undefined;
  operator: string;
  value: string;
  onChange: (value: string) => void;
}) => {
  if (field?.type === "boolean") {
    return (
      <select
        aria-label="Value"
        className={selectClass}
        value={value}
        onChange={(event) => onChange(event.target.value)}
      >
        <option value="">Choose…</option>
        <option value="true">Yes</option>
        <option value="false">No</option>
      </select>
    );
  }
  if (field?.type === "choice") {
    const choices: [string, string][] =
      operator === "where"
        ? columnMatches(field).map(([json, match]) => [
            json,
            columnsText(match),
          ])
        : (field.options ?? [])
            .filter((option) => !option.archived)
            .map((option) => [option.key, option.label]);
    return (
      <select
        aria-label="Value"
        className={selectClass}
        value={value}
        onChange={(event) => onChange(event.target.value)}
      >
        <option value="">Choose…</option>
        {choices.map(([choiceValue, label]) => (
          <option key={choiceValue} value={choiceValue}>
            {label}
          </option>
        ))}
      </select>
    );
  }
  return (
    <Input
      aria-label="Value"
      className="w-48"
      type={field?.type === "date" ? "date" : "text"}
      inputMode={
        field?.type === "number" || field?.type === "money"
          ? "decimal"
          : undefined
      }
      value={value}
      onChange={(event) => onChange(event.target.value)}
    />
  );
};

/** The filter value for an operator and the text the control holds. */
const valueFor = (field: FieldDescription, operator: string, text: string) => {
  if (operator === "isNull") {
    return true;
  }
  // A `where` value is one of the column matches, as JSON.
  return operator === "where" ? JSON.parse(text) : filterValue(field, text);
};

export const FilterBar = ({
  fields,
  filter,
  onChange,
}: {
  fields: FieldDescription[];
  filter: Filter;
  onChange: (filter: Filter) => void;
}) => {
  const usable = fields.filter(
    (field) => field.filters.length > 0 && field.type !== "ref"
  );
  const [key, setKey] = useState(usable[0]?.key ?? "");
  const field = usable.find((each) => each.key === key);
  const [operator, setOperator] = useState(field?.filters[0] ?? "");
  const [text, setText] = useState("");

  const add = (event: React.FormEvent) => {
    event.preventDefault();
    if (!(field && operator)) {
      return;
    }
    if (operator === "where" && !text) {
      return;
    }
    const value = valueFor(field, operator, text);
    onChange({
      ...filter,
      [field.key]: { ...filter[field.key], [operator]: value },
    });
    setText("");
  };

  const remove = (fieldKey: string, op: string) =>
    onChange(withoutFilter(filter, fieldKey, op));

  const labelOf = (fieldKey: string) =>
    fields.find((each) => each.key === fieldKey)?.label ?? fieldKey;

  return (
    <div className="flex flex-col gap-2">
      <form className="flex flex-wrap items-center gap-2" onSubmit={add}>
        <select
          aria-label="Field"
          className={selectClass}
          value={key}
          onChange={(event) => {
            const next = usable.find((each) => each.key === event.target.value);
            setKey(event.target.value);
            setOperator(next?.filters[0] ?? "");
          }}
        >
          {usable.map((each) => (
            <option key={each.key} value={each.key}>
              {each.label}
            </option>
          ))}
        </select>
        <select
          aria-label="Operator"
          className={selectClass}
          value={operator}
          onChange={(event) => setOperator(event.target.value)}
        >
          {field?.filters
            .filter((op) => op !== "in")
            .map((op) => (
              <option key={op} value={op}>
                {words[op] ?? op}
              </option>
            ))}
        </select>
        {operator !== "isNull" && (
          <FilterValue
            field={field}
            operator={operator}
            value={text}
            onChange={setText}
          />
        )}
        <Button type="submit" variant="outline" size="sm">
          Add filter
        </Button>
      </form>
      {Object.keys(filter).length > 0 && (
        <ul aria-label="Filters" className="flex flex-wrap gap-2">
          {Object.entries(filter).flatMap(([fieldKey, ops]) =>
            Object.entries(ops).map(([op, value]) => (
              <li
                key={`${fieldKey}.${op}`}
                className="flex items-center gap-1 rounded-full bg-muted py-0.5 pr-1 pl-3 text-xs"
              >
                {labelOf(fieldKey)} {words[op] ?? op}{" "}
                {op === "isNull"
                  ? ""
                  : shownFilterValue(
                      fields.find((each) => each.key === fieldKey),
                      op,
                      value
                    )}
                <Button
                  variant="ghost"
                  size="icon-xs"
                  aria-label={`Remove filter on ${labelOf(fieldKey)}`}
                  onClick={() => remove(fieldKey, op)}
                >
                  ×
                </Button>
              </li>
            ))
          )}
        </ul>
      )}
    </div>
  );
};
