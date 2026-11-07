// Pieces the Activity screens share (P1b.03): times, who did something,
// links to records and actions, raw JSON, filters and paging. Filters and
// the page are in the URL, like the object lists.
import { Link } from "@tanstack/react-router";
import { Button } from "@workspace/ui/components/button";
import { Input } from "@workspace/ui/components/input";
import { cn } from "@workspace/ui/lib/utils";
import { X } from "lucide-react";
import { useState } from "react";
import type { ReactNode } from "react";

import type { SystemDescription } from "../lib/api.ts";
import { findObject, titleOf } from "../lib/records.ts";

export const when = (at: string) =>
  new Date(at).toLocaleString("en-GB", {
    dateStyle: "medium",
    timeStyle: "medium",
  });

export interface Who {
  actor: { id: string; name: string; kind: string };
  origin: { id: string; name: string } | null;
}

/** "Claude for Sarah", or just "Sarah" when someone acted as themselves. */
export const WhoDid = ({
  who,
  onActor,
}: {
  who: Who;
  /** Filter by this actor, where the screen can. */
  onActor?: (actorId: string) => void;
}) => {
  const forSomeoneElse =
    who.origin !== null &&
    who.actor.kind !== "staff" &&
    who.origin.name !== who.actor.name;
  return (
    <span>
      {onActor ? (
        <button
          type="button"
          className="font-medium hover:underline"
          title={`Only ${who.actor.name}'s`}
          onClick={() => onActor(who.actor.id)}
        >
          {who.actor.name}
        </button>
      ) : (
        <span className="font-medium">{who.actor.name}</span>
      )}
      {forSomeoneElse ? (
        <span className="text-muted-foreground"> for {who.origin?.name}</span>
      ) : null}
    </span>
  );
};

const statusStyles: Record<string, string> = {
  succeeded: "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300",
  failed: "bg-destructive/10 text-destructive",
  pending_approval: "bg-amber-500/10 text-amber-700 dark:text-amber-300",
  rejected: "bg-muted text-muted-foreground",
};

export const StatusBadge = ({
  status,
  dryRun = false,
}: {
  status: string;
  dryRun?: boolean;
}) => (
  <span className="inline-flex items-center gap-1">
    <span
      className={cn(
        "rounded-full px-2 py-0.5 text-xs font-medium",
        statusStyles[status] ?? "bg-muted"
      )}
    >
      {status.replaceAll("_", " ")}
    </span>
    {dryRun ? (
      <span className="rounded-full bg-muted px-2 py-0.5 text-xs font-medium text-muted-foreground">
        dry run
      </span>
    ) : null}
  </span>
);

/** A changed value, short enough for one line. */
export const shortValue = (value: unknown) => {
  if (value === null || value === undefined || value === "") {
    return "empty";
  }
  return typeof value === "string" ? value : JSON.stringify(value);
};

const noValues: Record<string, unknown> = {};

/**
 * A link to a record, called by its title where the change carries it
 * ("Ada"), else by its object and the end of its id.
 */
export const RecordLink = ({
  object,
  recordId,
  values = noValues,
  description,
}: {
  object: string;
  recordId: string;
  /** The record's values from the change, to find its title in. */
  values?: Record<string, unknown>;
  description: SystemDescription | undefined;
}) => {
  const found = findObject(description, object);
  const title = titleOf({ id: recordId, ...values }, found);
  const label =
    title === recordId
      ? `${found?.label ?? object} …${recordId.slice(-6)}`
      : title;
  return found ? (
    <Link
      to="/o/$object/$id"
      params={{ object, id: recordId }}
      className="font-medium hover:underline"
    >
      {label}
    </Link>
  ) : (
    <span>{label}</span>
  );
};

/** The fields one change touched, by label, in the object's order. */
export const ChangedFields = ({
  object,
  before,
  after,
  description,
}: {
  object: string;
  before: Record<string, unknown>;
  after: Record<string, unknown>;
  description: SystemDescription | undefined;
}) => {
  const fields = findObject(description, object)?.fields ?? [];
  const order = (key: string) => {
    const index = fields.findIndex((field) => field.key === key);
    return index === -1 ? fields.length : index;
  };
  return (
    <ul className="flex flex-col gap-0.5">
      {Object.keys(after)
        .toSorted((a, b) => order(a) - order(b))
        .map((key) => (
          <li key={key}>
            <span className="text-muted-foreground">
              {fields.find((field) => field.key === key)?.label ?? key}:
            </span>{" "}
            {key in before ? `${shortValue(before[key])} → ` : null}
            {shortValue(after[key])}
          </li>
        ))}
    </ul>
  );
};

export const ActionLink = ({
  id,
  children,
}: {
  id: string;
  children: ReactNode;
}) => (
  <Link
    to="/activity/actions/$id"
    params={{ id }}
    className="font-mono text-xs hover:underline"
  >
    {children}
  </Link>
);

export const Json = ({ value }: { value: unknown }) => (
  <pre className="overflow-x-auto rounded-2xl bg-muted/50 p-3 font-mono text-xs/relaxed">
    {value === undefined ? "—" : JSON.stringify(value, null, 2)}
  </pre>
);

/** A text filter that applies on Enter or when it loses focus. */
export const TextFilter = ({
  label,
  value,
  placeholder,
  onChange,
}: {
  label: string;
  value: string | undefined;
  placeholder?: string;
  onChange: (value: string | undefined) => void;
}) => {
  const [draft, setDraft] = useState(value ?? "");
  const apply = () => onChange(draft.trim() === "" ? undefined : draft.trim());
  return (
    <label className="flex items-center gap-2 text-sm">
      <span className="text-muted-foreground">{label}</span>
      <Input
        className="h-8 w-48"
        value={draft}
        placeholder={placeholder}
        onChange={(event) => setDraft(event.target.value)}
        onBlur={apply}
        onKeyDown={(event) => {
          if (event.key === "Enter") {
            apply();
          }
        }}
      />
    </label>
  );
};

export const SelectFilter = ({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: string | undefined;
  options: { value: string; label: string }[];
  onChange: (value: string | undefined) => void;
}) => (
  <label className="flex items-center gap-2 text-sm">
    <span className="text-muted-foreground">{label}</span>
    <select
      className="h-8 rounded-2xl border bg-background px-2 text-sm"
      value={value ?? ""}
      onChange={(event) => onChange(event.target.value || undefined)}
    >
      <option value="">Any</option>
      {options.map((option) => (
        <option key={option.value} value={option.value}>
          {option.label}
        </option>
      ))}
    </select>
  </label>
);

/** A filter set from a link, such as an actor: shown as a removable chip. */
export const Chip = ({
  children,
  onRemove,
}: {
  children: ReactNode;
  onRemove: () => void;
}) => (
  <span className="inline-flex items-center gap-1 rounded-full border px-2.5 py-0.5 text-sm">
    {children}
    <button
      type="button"
      aria-label="Remove filter"
      className="text-muted-foreground hover:text-foreground"
      onClick={onRemove}
    >
      <X className="size-3.5" />
    </button>
  </span>
);

export interface PageSearch {
  cursor?: string;
  /** Cursors of earlier pages, for "Previous". */
  back?: string[];
}

export const pageSearch = (search: Record<string, unknown>): PageSearch => ({
  cursor: typeof search.cursor === "string" ? search.cursor : undefined,
  back: Array.isArray(search.back) ? (search.back as string[]) : undefined,
});

/** Previous and Next, keeping earlier cursors in the URL. */
export const Pager = ({
  search,
  nextCursor,
  onPage,
}: {
  search: PageSearch;
  nextCursor: string | null | undefined;
  onPage: (page: PageSearch) => void;
}) => {
  const back = search.back ?? [];
  return (
    <div className="flex justify-end gap-2">
      <Button
        variant="outline"
        size="sm"
        disabled={back.length === 0}
        onClick={() =>
          onPage({
            cursor: back.at(-1) || undefined,
            back: back.length > 1 ? back.slice(0, -1) : undefined,
          })
        }
      >
        Previous
      </Button>
      <Button
        variant="outline"
        size="sm"
        disabled={!nextCursor}
        onClick={() =>
          onPage({
            cursor: nextCursor ?? undefined,
            back: [...back, search.cursor ?? ""],
          })
        }
      >
        Next
      </Button>
    </div>
  );
};

export const ErrorText = ({ error }: { error: Error | null }) =>
  error ? (
    <p role="alert" className="text-sm text-destructive">
      {error.message}
    </p>
  ) : null;

export const text = (value: unknown) =>
  typeof value === "string" && value !== "" ? value : undefined;
