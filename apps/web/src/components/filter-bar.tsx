// Filter chips for a list. Each chip is one field, condition and value.
// Choosing a field starts a chip straight away. It stays out of the URL until
// Save, and a later edit does the same until the next Save. Add filter stays
// hidden while a chip is unsaved. Show archived lives in the Add filter menu.
import { Button } from "@workspace/ui/components/button";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@workspace/ui/components/dropdown-menu";
import { cn } from "@workspace/ui/lib/utils";
import { ChevronDown, ListFilter, X } from "lucide-react";
import { useState } from "react";

import { humanise } from "../lib/forms.ts";
import {
  displayValue,
  filterText,
  filterValue,
  withoutFilter,
} from "../lib/records.ts";
import type { FieldDescription, Filter } from "../lib/records.ts";

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

const segment =
  "flex items-center outline-none transition-colors hover:bg-muted focus-visible:bg-muted";

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

const operatorsOf = (filters: readonly string[], current: string) => {
  const offered = filters.filter((op) => op !== "in");
  return offered.includes(current) ? offered : [current, ...offered];
};

const menuOptions = (
  field: FieldDescription | undefined,
  operator: string
): [string, string][] => {
  if (field?.type === "boolean") {
    return [
      ["true", "Yes"],
      ["false", "No"],
    ];
  }
  if (field?.type !== "choice") {
    return [];
  }
  if (operator === "where") {
    return columnMatches(field).map(([json, match]) => [
      json,
      columnsText(match),
    ]);
  }
  return (field.options ?? [])
    .filter((option) => !option.archived)
    .map((option) => [option.key, option.label]);
};

/** Text fields type a value; choices and yes/no pick one; "is empty" has none. */
const valueKind = (
  field: FieldDescription | undefined,
  operator: string
): "none" | "text" | "menu" => {
  if (operator === "isNull") {
    return "none";
  }
  if (
    field?.type === "boolean" ||
    field?.type === "choice" ||
    operator === "where"
  ) {
    return "menu";
  }
  return "text";
};

const shownValue = (
  field: FieldDescription | undefined,
  operator: string,
  text: string
) => {
  if (operator === "where" && text) {
    try {
      return columnsText(JSON.parse(text) as unknown);
    } catch {
      return text;
    }
  }
  if (field?.type === "choice" && text) {
    return displayValue(field, { [field.key]: text }, {}, undefined);
  }
  if (field?.type === "boolean" && text) {
    return text === "true" ? "Yes" : "No";
  }
  return text;
};

/** A condition keeps its typed value when the next one still edits text. */
const textForOperator = (from: string, to: string, text: string) => {
  if (to === "isNull" || to === "where" || from === "where") {
    return "";
  }
  if (valueKind(undefined, to) !== "text") {
    return "";
  }
  return text;
};

const parsedValue = (
  field: FieldDescription,
  operator: string,
  text: string
): unknown | undefined => {
  if (operator === "isNull") {
    return true;
  }
  if (text.trim() === "") {
    return undefined;
  }
  if (operator === "where") {
    try {
      return JSON.parse(text) as unknown;
    } catch {
      return undefined;
    }
  }
  if (
    (field.type === "number" || field.type === "money") &&
    !Number.isFinite(Number(text))
  ) {
    return undefined;
  }
  return filterValue(field, text);
};

interface Draft {
  fieldKey: string;
  operator: string;
  text: string;
}

const chipKey = (chip: { fieldKey: string; operator: string; text: string }) =>
  `${chip.fieldKey}.${chip.operator}.${chip.text}`;

const OperatorMenu = ({
  field,
  operator,
  onOperator,
  onEscape,
}: {
  field: FieldDescription | undefined;
  operator: string;
  onOperator: (operator: string) => void;
  onEscape: () => void;
}) => (
  <DropdownMenu>
    <DropdownMenuTrigger
      className={cn(
        segment,
        "shrink-0 gap-1 border-l px-2 text-muted-foreground data-popup-open:bg-muted"
      )}
      onKeyDown={(event) => {
        if (event.key === "Escape") {
          onEscape();
        }
      }}
    >
      {words[operator] ?? operator}
      <ChevronDown className="size-3 opacity-60" />
    </DropdownMenuTrigger>
    <DropdownMenuContent className="min-w-40">
      <DropdownMenuGroup>
        <DropdownMenuRadioGroup value={operator} onValueChange={onOperator}>
          {operatorsOf(field?.filters ?? [], operator).map((op) => (
            <DropdownMenuRadioItem key={op} value={op}>
              {words[op] ?? op}
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
      </DropdownMenuGroup>
    </DropdownMenuContent>
  </DropdownMenu>
);

const TextValue = ({
  field,
  label,
  value,
  autoFocus,
  onChange,
  onSubmit,
  onEscape,
}: {
  field: FieldDescription | undefined;
  label: string;
  value: string;
  autoFocus: boolean;
  onChange: (text: string) => void;
  onSubmit: () => void;
  onEscape: () => void;
}) => (
  <input
    aria-label={`${label} value`}
    className={cn(
      "w-36 min-w-16 shrink border-l bg-transparent px-2 text-sm outline-none placeholder:text-muted-foreground",
      field?.type === "date" && "w-auto",
      (field?.type === "number" || field?.type === "money") && "tabular-nums"
    )}
    type={field?.type === "date" ? "date" : "text"}
    inputMode={
      field?.type === "number" || field?.type === "money"
        ? "decimal"
        : undefined
    }
    placeholder="Value"
    value={value}
    autoFocus={autoFocus}
    onChange={(event) => onChange(event.target.value)}
    onKeyDown={(event) => {
      if (event.key === "Enter") {
        event.preventDefault();
        onSubmit();
      }
      if (event.key === "Escape") {
        onEscape();
      }
    }}
  />
);

const MenuValue = ({
  field,
  operator,
  text,
  autoFocus,
  onChange,
  onEscape,
}: {
  field: FieldDescription | undefined;
  operator: string;
  text: string;
  autoFocus: boolean;
  onChange: (text: string) => void;
  onEscape: () => void;
}) => {
  const options = menuOptions(field, operator);
  const [open, setOpen] = useState(autoFocus);
  const label = shownValue(field, operator, text);
  return (
    <DropdownMenu open={open} onOpenChange={setOpen}>
      <DropdownMenuTrigger
        className={cn(
          segment,
          "max-w-48 min-w-0 shrink gap-1 border-l px-2 data-popup-open:bg-muted",
          text ? "text-foreground" : "text-muted-foreground"
        )}
        onKeyDown={(event) => {
          if (event.key === "Escape") {
            onEscape();
          }
        }}
      >
        <span className="truncate">{label || "Choose…"}</span>
        <ChevronDown className="size-3 shrink-0 opacity-60" />
      </DropdownMenuTrigger>
      <DropdownMenuContent className="min-w-40">
        <DropdownMenuGroup>
          <DropdownMenuRadioGroup value={text} onValueChange={onChange}>
            {options.map(([choice, choiceLabel]) => (
              <DropdownMenuRadioItem key={choice} value={choice}>
                {choiceLabel}
              </DropdownMenuRadioItem>
            ))}
          </DropdownMenuRadioGroup>
        </DropdownMenuGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
};

const ChipAction = ({
  label,
  pending,
  canSave,
  onSave,
  onRemove,
  onEscape,
}: {
  label: string;
  pending: boolean;
  canSave: boolean;
  onSave: () => void;
  onRemove: () => void;
  onEscape: () => void;
}) => (
  <button
    type="button"
    className={cn(
      segment,
      "shrink-0 border-l",
      pending
        ? "px-2 font-medium text-foreground disabled:opacity-40"
        : "px-1.5 text-muted-foreground"
    )}
    aria-label={
      pending ? `Save filter on ${label}` : `Remove filter on ${label}`
    }
    disabled={pending && !canSave}
    onClick={() => {
      if (pending) {
        if (canSave) {
          onSave();
        }
        return;
      }
      onRemove();
    }}
    onKeyDown={(event) => {
      if (event.key === "Escape") {
        onEscape();
      }
    }}
  >
    {pending ? "Save" : <X className="size-3.5" />}
  </button>
);

const FilterChip = ({
  field,
  operator,
  text,
  committed,
  autoFocus,
  onSave,
  onRemove,
  onPendingChange,
}: {
  field: FieldDescription | undefined;
  operator: string;
  text: string;
  committed: boolean;
  autoFocus: boolean;
  onSave: (operator: string, text: string) => void;
  onRemove: () => void;
  onPendingChange?: (pending: boolean) => void;
}) => {
  const label = field?.label ?? "";
  const [op, setOp] = useState(operator);
  const [typed, setTyped] = useState(text);
  const kind = valueKind(field, op);
  const pending = !committed || op !== operator || typed !== text;
  const canSave = field ? parsedValue(field, op, typed) !== undefined : false;
  const publish = (nextOp: string, nextTyped: string) => {
    onPendingChange?.(!committed || nextOp !== operator || nextTyped !== text);
  };
  const save = () => {
    if (canSave) {
      onSave(op, typed);
    }
  };
  const revert = () => {
    if (!committed) {
      onRemove();
      return;
    }
    setOp(operator);
    setTyped(text);
    onPendingChange?.(false);
  };
  const editText = (value: string) => {
    setTyped(value);
    publish(op, value);
  };
  const sentence = [
    label,
    words[op] ?? op,
    shownValue(field, op, kind === "none" ? "" : typed),
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <fieldset
      aria-label={sentence}
      data-complete={pending ? "false" : "true"}
      className="m-0 inline-flex h-7 max-w-full min-w-0 items-stretch overflow-hidden rounded-2xl border border-border bg-background p-0 text-sm"
    >
      <span className="flex shrink-0 items-center px-2.5 font-medium whitespace-nowrap">
        {label}
      </span>
      <OperatorMenu
        field={field}
        operator={op}
        onOperator={(next) => {
          const nextText = textForOperator(op, next, typed);
          setTyped(nextText);
          setOp(next);
          publish(next, nextText);
        }}
        onEscape={revert}
      />
      {kind === "text" ? (
        <TextValue
          field={field}
          label={label}
          value={typed}
          autoFocus={autoFocus}
          onChange={editText}
          onSubmit={save}
          onEscape={revert}
        />
      ) : null}
      {kind === "menu" ? (
        <MenuValue
          field={field}
          operator={op}
          text={typed}
          autoFocus={autoFocus}
          onChange={editText}
          onEscape={revert}
        />
      ) : null}
      <ChipAction
        label={label}
        pending={pending}
        canSave={canSave}
        onSave={save}
        onRemove={onRemove}
        onEscape={revert}
      />
    </fieldset>
  );
};

const defaultOperator = (field: FieldDescription, filter: Filter) => {
  const used = new Set(Object.keys(filter[field.key] ?? {}));
  return (
    field.filters.find((op) => op !== "in" && !used.has(op)) ??
    field.filters.find((op) => op !== "in") ??
    ""
  );
};

export const FilterBar = ({
  fields,
  filter,
  onChange,
  archived,
  onArchivedChange,
}: {
  fields: FieldDescription[];
  filter: Filter;
  onChange: (filter: Filter) => void;
  archived: boolean;
  onArchivedChange: (archived: boolean) => void;
}) => {
  const usable = fields.filter(
    (field) => field.filters.length > 0 && field.type !== "ref"
  );
  const [draft, setDraft] = useState<Draft | null>(null);
  const [pendingChips, setPendingChips] = useState<ReadonlySet<string>>(
    () => new Set()
  );
  const fieldOf = (key: string) => fields.find((field) => field.key === key);
  const setChipPending = (key: string, pending: boolean) => {
    setPendingChips((current) => {
      if (current.has(key) === pending) {
        return current;
      }
      const next = new Set(current);
      if (pending) {
        next.add(key);
      } else {
        next.delete(key);
      }
      return next;
    });
  };

  const write = (
    fieldKey: string,
    operator: string,
    text: string,
    replace?: string
  ) => {
    const field = fieldOf(fieldKey);
    if (!field) {
      return;
    }
    const stripped = replace
      ? withoutFilter(filter, fieldKey, replace)
      : filter;
    const value = parsedValue(field, operator, text);
    if (value === undefined) {
      // An emptied chip leaves the query, and stays on screen as a draft.
      const next =
        stripped[fieldKey]?.[operator] === undefined
          ? stripped
          : withoutFilter(stripped, fieldKey, operator);
      if (JSON.stringify(next) !== JSON.stringify(filter)) {
        onChange(next);
      }
      setDraft({ fieldKey, operator, text });
      return;
    }
    const next = {
      ...stripped,
      [fieldKey]: { ...stripped[fieldKey], [operator]: value },
    };
    if (JSON.stringify(next) !== JSON.stringify(filter)) {
      onChange(next);
    }
    setDraft((current) => (current?.fieldKey === fieldKey ? null : current));
  };

  const chips = Object.entries(filter).flatMap(([fieldKey, ops]) =>
    Object.entries(ops).map(([op, value]) => ({
      fieldKey,
      operator: op,
      text: filterText(fieldOf(fieldKey), op, value),
    }))
  );
  const hidden = draft === null ? "" : `${draft.fieldKey}.${draft.operator}`;
  const unfinished =
    draft !== null || chips.some((chip) => pendingChips.has(chipKey(chip)));

  return (
    <div
      role="toolbar"
      aria-label="Filters"
      className="flex w-full min-w-0 flex-wrap items-center gap-1.5"
    >
      {chips
        .filter((chip) => `${chip.fieldKey}.${chip.operator}` !== hidden)
        .map((chip) => (
          <FilterChip
            key={chipKey(chip)}
            field={fieldOf(chip.fieldKey)}
            operator={chip.operator}
            text={chip.text}
            committed
            autoFocus={false}
            onSave={(nextOperator, nextText) =>
              write(
                chip.fieldKey,
                nextOperator,
                nextText,
                nextOperator === chip.operator ? undefined : chip.operator
              )
            }
            onRemove={() => {
              onChange(withoutFilter(filter, chip.fieldKey, chip.operator));
            }}
            onPendingChange={(pending) =>
              setChipPending(chipKey(chip), pending)
            }
          />
        ))}
      {draft ? (
        <FilterChip
          key={`draft:${draft.fieldKey}:${draft.operator}`}
          field={fieldOf(draft.fieldKey)}
          operator={draft.operator}
          text={draft.text}
          committed={false}
          autoFocus
          onSave={(nextOperator, nextText) =>
            write(draft.fieldKey, nextOperator, nextText)
          }
          onRemove={() => setDraft(null)}
        />
      ) : null}
      {unfinished ? null : (
        <DropdownMenu>
          <DropdownMenuTrigger render={<Button variant="outline" size="sm" />}>
            <ListFilter data-icon="inline-start" />
            Add filter
          </DropdownMenuTrigger>
          <DropdownMenuContent className="min-w-44">
            <DropdownMenuGroup>
              {usable.map((field) => (
                <DropdownMenuItem
                  key={field.key}
                  onClick={() =>
                    setDraft({
                      fieldKey: field.key,
                      operator: defaultOperator(field, filter),
                      text: "",
                    })
                  }
                >
                  {field.label}
                </DropdownMenuItem>
              ))}
            </DropdownMenuGroup>
            <DropdownMenuSeparator />
            <DropdownMenuGroup>
              <DropdownMenuCheckboxItem
                checked={archived}
                closeOnClick={false}
                onCheckedChange={(checked) =>
                  onArchivedChange(checked === true)
                }
              >
                Show archived
              </DropdownMenuCheckboxItem>
            </DropdownMenuGroup>
          </DropdownMenuContent>
        </DropdownMenu>
      )}
      {chips.length > 0 || draft ? (
        <Button
          variant="ghost"
          size="sm"
          onClick={() => {
            setDraft(null);
            if (Object.keys(filter).length > 0) {
              onChange({});
            }
          }}
        >
          Clear
        </Button>
      ) : null}
    </div>
  );
};
