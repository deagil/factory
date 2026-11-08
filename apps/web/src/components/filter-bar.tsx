// Adds and removes list filters. Fields and operators come from
// system.describe; the filters live in the URL (P1.20).
import { Button } from "@workspace/ui/components/button";
import { Input } from "@workspace/ui/components/input";
import { useState } from "react";

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
  category: "is in",
};

const shownFilterValue = (
  field: FieldDescription | undefined,
  value: unknown
) => {
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
    const live = (field.options ?? []).filter((option) => !option.archived);
    const byCategory = operator === "category";
    const keys = byCategory
      ? [
          ...new Set(
            live.flatMap((option) => (option.category ? [option.category] : []))
          ),
        ]
      : live.map((option) => option.key);
    const labelOf = (key: string) =>
      byCategory
        ? key
        : (live.find((option) => option.key === key)?.label ?? key);
    return (
      <select
        aria-label="Value"
        className={selectClass}
        value={value}
        onChange={(event) => onChange(event.target.value)}
      >
        <option value="">Choose…</option>
        {keys.map((key) => (
          <option key={key} value={key}>
            {labelOf(key)}
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
    const value = operator === "isNull" ? true : filterValue(field, text);
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
