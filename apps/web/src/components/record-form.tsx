// A form for one action, with a control per field its input takes (P1.21).
import { useQuery } from "@tanstack/react-query";
import { Button } from "@workspace/ui/components/button";
import { Input } from "@workspace/ui/components/input";
import { Label } from "@workspace/ui/components/label";
import { Switch } from "@workspace/ui/components/switch";
import { LinkIcon, Mail } from "lucide-react";
import { useState } from "react";

import { ApiCallError, objectApi, runQuery } from "../lib/api.ts";
import type { SystemDescription } from "../lib/api.ts";
import type { FormField, FormValues } from "../lib/forms.ts";
import {
  currencySymbol,
  findObject,
  isMoney,
  minorDigits,
  titleOf,
} from "../lib/records.ts";
import type { ListPage } from "../lib/records.ts";

const selectClass =
  "h-8 w-full rounded-2xl border border-input bg-muted px-2 text-sm shadow-[inset_0_1px_2px_rgb(0_0_0/0.06)] outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/30 aria-invalid:border-destructive aria-invalid:ring-3 aria-invalid:ring-destructive/20 dark:shadow-[inset_0_1px_2px_rgb(0_0_0/0.35)] dark:aria-invalid:border-destructive/50 dark:aria-invalid:ring-destructive/40";

interface FieldIssue {
  path: (string | number)[];
  message: string;
}

/** The field key an issue names, when it names one. */
const issueField = (issue: FieldIssue) =>
  typeof issue.path[0] === "string" ? issue.path[0] : undefined;

const issuesOf = (error: Error | null): FieldIssue[] => {
  if (!(error instanceof ApiCallError) || !("issues" in error.error)) {
    return [];
  }
  const { issues } = error.error;
  return Array.isArray(issues) ? (issues as FieldIssue[]) : [];
};

/** `aria-invalid` and a description that includes the field's error. */
const invalidProps = (invalid: boolean, id: string, extra?: string) => {
  const describedBy = [extra, invalid ? `${id}-error` : undefined]
    .filter((item) => item !== undefined && item !== "")
    .join(" ");
  return {
    "aria-invalid": invalid || undefined,
    "aria-describedby": describedBy === "" ? undefined : describedBy,
  };
};

/** A select of the target's records, or a plain id input if it has no list. */
const RefSelect = ({
  field,
  value,
  invalid,
  onChange,
  description,
}: {
  field: FormField;
  value: string;
  invalid: boolean;
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
    : findObject(description, target) !== undefined && can(`${target}_list`);
  const options = useQuery({
    queryKey: ["options", target],
    queryFn: async (): Promise<Record<string, unknown>[]> => {
      if (isActor) {
        const { entries } = await runQuery<{
          entries: Record<string, unknown>[];
        }>("actor.list", { kind: "staff", status: "active", limit: 200 });
        return entries;
      }
      const { records } = await objectApi(
        target,
        findObject(description, target)?.endpoints
      ).list<ListPage>({ limit: 100 });
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
        {...invalidProps(invalid, field.key)}
      />
    );
  }
  const object = findObject(description, target);
  const labelOf = (record: Record<string, unknown>) => {
    if (!isActor) {
      return titleOf(record, object);
    }
    const name =
      typeof record.name === "string" && record.name !== ""
        ? record.name
        : String(record.id);
    const email = (record.user as { email?: string } | null)?.email;
    return email ? `${name} (${email})` : name;
  };
  return (
    <select
      id={field.key}
      className={selectClass}
      value={value}
      required={field.required}
      onChange={(event) => onChange(event.target.value)}
      {...invalidProps(invalid, field.key)}
    >
      <option value="">{options.isPending ? "Loading…" : "None"}</option>
      {options.data?.map((record) => (
        <option key={String(record.id)} value={String(record.id)}>
          {labelOf(record)}
        </option>
      ))}
    </select>
  );
};

/** A select of the choice's live options. An archived value stays visible. */
const ChoiceSelect = ({
  field,
  value,
  invalid,
  onChange,
}: {
  field: FormField;
  value: string;
  invalid: boolean;
  onChange: (value: string) => void;
}) => {
  const options = (field.options ?? []).filter(
    (option) => !option.archived || option.key === value
  );
  // The chosen option's description, as a hint under the select.
  const hint = options.find((option) => option.key === value)?.description;
  return (
    <>
      <select
        id={field.key}
        className={selectClass}
        value={value}
        required={field.required}
        {...invalidProps(
          invalid,
          field.key,
          hint ? `${field.key}-hint` : undefined
        )}
        onChange={(event) => onChange(event.target.value)}
      >
        <option value="">{field.required ? "Choose…" : "None"}</option>
        {options.map((option) => (
          <option
            key={option.key}
            value={option.key}
            title={option.description ?? undefined}
          >
            {option.archived ? `${option.label} (archived)` : option.label}
          </option>
        ))}
      </select>
      {hint && (
        <p id={`${field.key}-hint`} className="text-xs text-muted-foreground">
          {hint}
        </p>
      )}
    </>
  );
};

const inputTypes: Record<string, string> = {
  number: "number",
  date: "date",
};

/** Major units, as text, so the currency's decimal places stay visible. */
const MoneyInput = ({
  field,
  value,
  currency,
  invalid,
  onChange,
}: {
  field: FormField;
  value: string;
  currency: string;
  invalid: boolean;
  onChange: (value: string) => void;
}) => {
  const digits = minorDigits(currency);
  const showDecimals = (event: React.FocusEvent<HTMLInputElement>) => {
    const text = event.target.value.trim();
    if (text === "") {
      return;
    }
    const major = Number(text);
    if (!Number.isFinite(major)) {
      return;
    }
    const shown = major.toFixed(digits);
    if (shown !== event.target.value) {
      onChange(shown);
    }
  };
  return (
    <div className="relative">
      <span
        aria-hidden
        className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-sm text-muted-foreground"
      >
        {currencySymbol(currency)}
      </span>
      <Input
        id={field.key}
        type="text"
        inputMode="decimal"
        autoComplete="off"
        spellCheck={false}
        className="pl-8 tabular-nums"
        value={value}
        required={field.required}
        placeholder={(0).toFixed(digits)}
        onChange={(event) => onChange(event.target.value)}
        onBlur={showDecimals}
        {...invalidProps(invalid, field.key)}
      />
    </div>
  );
};

/** An address, with an envelope in the same slot as a money field's symbol. */
const EmailInput = ({
  field,
  value,
  invalid,
  onChange,
}: {
  field: FormField;
  value: string;
  invalid: boolean;
  onChange: (value: string) => void;
}) => (
  <div className="relative">
    <Mail
      aria-hidden
      className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground"
    />
    <Input
      id={field.key}
      type="email"
      inputMode="email"
      autoComplete="email"
      spellCheck={false}
      className="pl-9"
      value={value}
      required={field.required}
      placeholder="name@example.com"
      onChange={(event) => onChange(event.target.value)}
      onBlur={(event) => {
        const shown = event.target.value.trim();
        if (shown !== event.target.value) {
          onChange(shown);
        }
      }}
      {...invalidProps(invalid, field.key)}
    />
  </div>
);

/** An address, with a link mark in the same slot as an email field's envelope. */
const UrlInput = ({
  field,
  value,
  invalid,
  onChange,
}: {
  field: FormField;
  value: string;
  invalid: boolean;
  onChange: (value: string) => void;
}) => (
  <div className="relative">
    <LinkIcon
      aria-hidden
      className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground"
    />
    <Input
      id={field.key}
      type="text"
      inputMode="url"
      autoComplete="url"
      spellCheck={false}
      className="pl-9"
      value={value}
      required={field.required}
      placeholder="example.com"
      onChange={(event) => onChange(event.target.value)}
      onBlur={(event) => {
        const shown = event.target.value.trim().replace(/^https?:\/\//iu, "");
        if (shown !== event.target.value) {
          onChange(shown);
        }
      }}
      {...invalidProps(invalid, field.key)}
    />
  </div>
);

const FieldControl = ({
  field,
  value,
  currency,
  invalid,
  onChange,
  description,
}: {
  field: FormField;
  value: string | boolean;
  /** The money field's currency. Other types ignore it. */
  currency: string;
  invalid: boolean;
  onChange: (value: string) => void;
  description: SystemDescription | undefined;
}) => {
  if (field.type === "money") {
    return (
      <MoneyInput
        field={field}
        value={String(value ?? "")}
        currency={currency}
        invalid={invalid}
        onChange={onChange}
      />
    );
  }
  if (field.type === "email") {
    return (
      <EmailInput
        field={field}
        value={String(value ?? "")}
        invalid={invalid}
        onChange={onChange}
      />
    );
  }
  if (field.type === "url") {
    return (
      <UrlInput
        field={field}
        value={String(value ?? "")}
        invalid={invalid}
        onChange={onChange}
      />
    );
  }
  if (field.type === "ref") {
    return (
      <RefSelect
        field={field}
        value={String(value ?? "")}
        invalid={invalid}
        onChange={onChange}
        description={description}
      />
    );
  }
  if (field.type === "choice") {
    return (
      <ChoiceSelect
        field={field}
        value={String(value ?? "")}
        invalid={invalid}
        onChange={onChange}
      />
    );
  }
  return (
    <Input
      id={field.key}
      type={inputTypes[field.type] ?? "text"}
      value={String(value ?? "")}
      required={field.required}
      onChange={(event) => onChange(event.target.value)}
      {...invalidProps(invalid, field.key)}
    />
  );
};

/** What went wrong, with each invalid field's message. */
export const ErrorMessage = ({
  error,
  reported,
}: {
  error: Error | null;
  /** Field keys whose messages are shown on the control, so the list skips them. */
  reported?: ReadonlySet<string>;
}) => {
  if (!error) {
    return null;
  }
  if (error instanceof ApiCallError && error.error.code === "conflict") {
    return (
      <div role="alert" className="text-sm text-destructive">
        <p>
          Someone changed this record after you opened it. Reload to see their
          change, then make yours again.
        </p>
        <p className="text-muted-foreground">{error.message}</p>
      </div>
    );
  }
  const issues = issuesOf(error).filter((issue) => {
    const key = issueField(issue);
    return key === undefined || !reported?.has(key);
  });
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

/** A dry run's result: what the action would have returned. */
export const DryRunResult = ({ output }: { output: unknown }) => (
  <div aria-live="polite" className="flex flex-col gap-1 text-sm">
    <p>Dry run: the action passed every check and changed nothing.</p>
    <pre className="max-h-64 overflow-auto rounded-md bg-muted p-2 text-xs">
      {JSON.stringify(output, null, 2)}
    </pre>
  </div>
);

const currencyOf = (
  field: FormField,
  record: Record<string, unknown> | undefined
) => {
  const value = record?.[field.key];
  return isMoney(value) ? value.currency : "GBP";
};

export const RecordForm = ({
  fields,
  initial,
  record,
  description,
  submitLabel,
  pending,
  error,
  dryRun,
  onSubmit,
  onCancel,
}: {
  fields: FormField[];
  initial: FormValues;
  /** The record being edited, so a money field keeps its currency. */
  record?: Record<string, unknown>;
  description: SystemDescription | undefined;
  submitLabel: string;
  pending: boolean;
  error: Error | null;
  /** Set after a dry run: the output the action would have returned. */
  dryRun?: { output: unknown } | undefined;
  onSubmit: (values: FormValues) => void;
  onCancel?: () => void;
}) => {
  const [values, setValues] = useState(initial);
  const [dismissed, setDismissed] = useState<{
    error: Error | null;
    keys: ReadonlySet<string>;
  }>({ error: null, keys: new Set() });
  const dismissedKeys =
    dismissed.error === error ? dismissed.keys : new Set<string>();
  const set = (key: string, value: string | boolean) => {
    setValues((previous) => ({ ...previous, [key]: value }));
    setDismissed((current) => ({
      error,
      keys: new Set([...(current.error === error ? current.keys : []), key]),
    }));
  };

  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    onSubmit(values);
  };

  const fieldIssues = issuesOf(error);
  const issues = new Map(
    fieldIssues.flatMap((issue) => {
      const key = issueField(issue);
      return key === undefined || dismissedKeys.has(key)
        ? []
        : [[key, issue.message] as const];
    })
  );
  const everyIssueCleared =
    fieldIssues.length > 0 &&
    fieldIssues.every((issue) => {
      const key = issueField(issue);
      return key !== undefined && dismissedKeys.has(key);
    });

  return (
    <form onSubmit={submit} className="flex max-w-lg flex-col gap-4">
      {fields.map((field) => {
        const value = values[field.key];
        const message = issues.get(field.key);
        return (
          <div key={field.key} className="flex flex-col gap-1.5">
            <Label htmlFor={field.key}>
              {field.label}
              {field.required && " *"}
            </Label>
            {field.type === "boolean" ? (
              <Switch
                id={field.key}
                checked={value === true}
                onCheckedChange={(checked) => set(field.key, checked)}
                {...invalidProps(message !== undefined, field.key)}
              />
            ) : (
              <FieldControl
                field={field}
                value={value ?? ""}
                currency={currencyOf(field, record)}
                invalid={message !== undefined}
                onChange={(next) => set(field.key, next)}
                description={description}
              />
            )}
            {message !== undefined && (
              <p id={`${field.key}-error`} className="text-xs text-destructive">
                {message}
              </p>
            )}
          </div>
        );
      })}
      {everyIssueCleared ? null : (
        <ErrorMessage
          error={error}
          reported={new Set([...issues.keys(), ...dismissedKeys])}
        />
      )}
      {dryRun ? <DryRunResult output={dryRun.output} /> : null}
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
