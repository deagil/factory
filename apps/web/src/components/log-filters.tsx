// The log lists' filter bar: the same chips as an object list, for the
// parameters the log queries already accept.
import { useQuery } from "@tanstack/react-query";
import { Button } from "@workspace/ui/components/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from "@workspace/ui/components/dropdown-menu";
import { cn } from "@workspace/ui/lib/utils";
import { ChevronDown, ListFilter, X } from "lucide-react";
import { useState } from "react";

import { runQuery } from "../lib/api.ts";

export interface LogFilterSpec {
  key: string;
  label: string;
  /** The word between the name and the value, as `is` or `starts with`. */
  operator: string;
  kind: "text" | "choice" | "date";
  placeholder?: string;
  options?: { value: string; label: string }[];
}

/** A filter arrived at from a link, such as one record. It can only be removed. */
export interface PinnedFilter {
  key: string;
  label: string;
  operator: string;
  value: string;
  onRemove: () => void;
}

interface ListedActor {
  id: string;
  name: string;
  kind: string;
  user: { id: string; name: string } | null;
}

const chip =
  "m-0 inline-flex h-7 max-w-full min-w-0 items-stretch overflow-hidden rounded-2xl border border-border bg-background p-0 text-sm";

const segment =
  "flex items-center outline-none transition-colors hover:bg-muted focus-visible:bg-muted";

const actorLabel = (actor: ListedActor) =>
  actor.kind === "staff" ? actor.name : `${actor.name} (${actor.kind})`;

/** People the log can be filtered by: who acted, or who it was for. */
export const useLogPeople = (mode: "actor" | "user") => {
  const listed = useQuery({
    queryKey: ["actor.list", "log-filters"],
    queryFn: () =>
      runQuery<{ entries: ListedActor[] }>("actor.list", { limit: 200 }),
  });
  const options =
    mode === "actor"
      ? (listed.data?.entries ?? []).map((actor) => ({
          value: actor.id,
          label: actorLabel(actor),
        }))
      : [
          ...new Map(
            (listed.data?.entries ?? []).flatMap((actor) =>
              actor.user ? [[actor.user.id, actor.user.name] as const] : []
            )
          ).entries(),
        ].map(([id, name]) => ({ value: id, label: name }));
  return options.toSorted((a, b) => a.label.localeCompare(b.label));
};

const menuLabel = (filter: LogFilterSpec, filters: readonly LogFilterSpec[]) =>
  filters.filter((item) => item.label === filter.label).length > 1
    ? `${filter.label}, ${filter.operator}`
    : filter.label;

const shown = (filter: LogFilterSpec, value: string) =>
  filter.options?.find((option) => option.value === value)?.label ?? value;

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

const ChoiceValue = ({
  filter,
  value,
  autoFocus,
  onChange,
  onEscape,
}: {
  filter: LogFilterSpec;
  value: string;
  autoFocus: boolean;
  onChange: (value: string) => void;
  onEscape: () => void;
}) => {
  const [open, setOpen] = useState(autoFocus);
  const options =
    value && !filter.options?.some((option) => option.value === value)
      ? [{ value, label: value.slice(0, 8) }, ...(filter.options ?? [])]
      : (filter.options ?? []);
  const label = options.find((option) => option.value === value)?.label;
  return (
    <DropdownMenu open={open} onOpenChange={setOpen}>
      <DropdownMenuTrigger
        className={cn(
          segment,
          "max-w-48 min-w-0 shrink gap-1 border-l px-2 data-popup-open:bg-muted",
          value ? "text-foreground" : "text-muted-foreground"
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
          <DropdownMenuRadioGroup value={value} onValueChange={onChange}>
            {options.map((option) => (
              <DropdownMenuRadioItem key={option.value} value={option.value}>
                {option.label}
              </DropdownMenuRadioItem>
            ))}
          </DropdownMenuRadioGroup>
        </DropdownMenuGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
};

const LogChip = ({
  filter,
  value,
  committed,
  autoFocus,
  onSave,
  onRemove,
  onPendingChange,
}: {
  filter: LogFilterSpec;
  value: string;
  committed: boolean;
  autoFocus: boolean;
  onSave: (value: string) => void;
  onRemove: () => void;
  onPendingChange?: (pending: boolean) => void;
}) => {
  const [typed, setTyped] = useState(value);
  const pending = !committed || typed !== value;
  const canSave = typed.trim() !== "";
  const sentence = [filter.label, filter.operator, shown(filter, typed)]
    .filter(Boolean)
    .join(" ");
  const revert = () => {
    if (!committed) {
      onRemove();
      return;
    }
    setTyped(value);
    onPendingChange?.(false);
  };
  const save = () => {
    if (canSave) {
      onSave(typed.trim());
    }
  };
  const edit = (next: string) => {
    setTyped(next);
    onPendingChange?.(!committed || next !== value);
  };

  return (
    <fieldset
      aria-label={sentence}
      data-complete={pending ? "false" : "true"}
      className={chip}
    >
      <span className="flex shrink-0 items-center px-2.5 font-medium whitespace-nowrap">
        {filter.label}
      </span>
      <span className="flex shrink-0 items-center border-l px-2 text-muted-foreground">
        {filter.operator}
      </span>
      {filter.kind === "choice" ? (
        <ChoiceValue
          filter={filter}
          value={typed}
          autoFocus={autoFocus}
          onChange={edit}
          onEscape={revert}
        />
      ) : (
        <input
          aria-label={`${filter.label} value`}
          className={cn(
            "min-w-16 shrink border-l bg-transparent px-2 text-sm outline-none placeholder:text-muted-foreground",
            filter.kind === "date" ? "w-auto" : "w-36"
          )}
          type={filter.kind === "date" ? "date" : "text"}
          placeholder={filter.placeholder ?? "Value"}
          value={typed}
          autoFocus={autoFocus}
          onChange={(event) => edit(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault();
              save();
            }
            if (event.key === "Escape") {
              revert();
            }
          }}
        />
      )}
      <ChipAction
        label={filter.label}
        pending={pending}
        canSave={canSave}
        onSave={save}
        onRemove={onRemove}
        onEscape={revert}
      />
    </fieldset>
  );
};

const PinnedChip = ({ pin }: { pin: PinnedFilter }) => (
  <fieldset
    aria-label={`${pin.label} ${pin.operator} ${pin.value}`}
    data-complete="true"
    className={chip}
  >
    <span className="flex shrink-0 items-center px-2.5 font-medium whitespace-nowrap">
      {pin.label}
    </span>
    <span className="flex shrink-0 items-center border-l px-2 text-muted-foreground">
      {pin.operator}
    </span>
    <span className="flex min-w-0 items-center truncate border-l px-2">
      {pin.value}
    </span>
    <button
      type="button"
      className={cn(segment, "shrink-0 border-l px-1.5 text-muted-foreground")}
      aria-label={`Remove filter on ${pin.label}`}
      onClick={() => pin.onRemove()}
    >
      <X className="size-3.5" />
    </button>
  </fieldset>
);

const noPins: readonly PinnedFilter[] = [];

export const LogFilterBar = ({
  filters,
  values,
  pinned = noPins,
  onChange,
  onClear,
}: {
  filters: readonly LogFilterSpec[];
  values: Record<string, string | undefined>;
  pinned?: readonly PinnedFilter[];
  onChange: (key: string, value: string | undefined) => void;
  onClear: () => void;
}) => {
  const [draft, setDraft] = useState<string | null>(null);
  const [pending, setPending] = useState<ReadonlySet<string>>(() => new Set());
  const setChipPending = (key: string, next: boolean) => {
    setPending((current) => {
      if (current.has(key) === next) {
        return current;
      }
      const copy = new Set(current);
      if (next) {
        copy.add(key);
      } else {
        copy.delete(key);
      }
      return copy;
    });
  };
  const draftFilter = filters.find((filter) => filter.key === draft);
  const unfinished = draft !== null || pending.size > 0;
  const available = filters.filter(
    (filter) => !values[filter.key] && filter.key !== draft
  );
  const active = Object.values(values).some(Boolean) || pinned.length > 0;

  return (
    <div
      role="toolbar"
      aria-label="Filters"
      className="flex w-full min-w-0 flex-wrap items-center gap-1.5"
    >
      {filters
        .filter((filter) => values[filter.key] && filter.key !== draft)
        .map((filter) => (
          <LogChip
            key={`${filter.key}:${values[filter.key]}`}
            filter={filter}
            value={values[filter.key] ?? ""}
            committed
            autoFocus={false}
            onSave={(value) => {
              onChange(filter.key, value);
              setChipPending(filter.key, false);
            }}
            onRemove={() => onChange(filter.key, undefined)}
            onPendingChange={(next) => setChipPending(filter.key, next)}
          />
        ))}
      {pinned.map((pin) => (
        <PinnedChip key={pin.key} pin={pin} />
      ))}
      {draftFilter ? (
        <LogChip
          key={`draft:${draftFilter.key}`}
          filter={draftFilter}
          value=""
          committed={false}
          autoFocus
          onSave={(value) => {
            onChange(draftFilter.key, value);
            setDraft(null);
          }}
          onRemove={() => setDraft(null)}
        />
      ) : null}
      {unfinished || available.length === 0 ? null : (
        <DropdownMenu>
          <DropdownMenuTrigger render={<Button variant="outline" size="sm" />}>
            <ListFilter data-icon="inline-start" />
            Add filter
          </DropdownMenuTrigger>
          <DropdownMenuContent className="min-w-44">
            <DropdownMenuGroup>
              {available.map((filter) => (
                <DropdownMenuItem
                  key={filter.key}
                  onClick={() => setDraft(filter.key)}
                >
                  {menuLabel(filter, filters)}
                </DropdownMenuItem>
              ))}
            </DropdownMenuGroup>
          </DropdownMenuContent>
        </DropdownMenu>
      )}
      {active || draft ? (
        <Button
          variant="ghost"
          size="sm"
          onClick={() => {
            setDraft(null);
            setPending(new Set());
            onClear();
          }}
        >
          Clear
        </Button>
      ) : null}
    </div>
  );
};
