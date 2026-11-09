// Forms built from action input schemas (P1.21). A field is editable only
// if the action's input has it, so a read-only field never gets a control.
// Labels and types come from the object's fields in system.describe.
import type { SystemDescription } from "./api.ts";
import type { FieldDescription, ObjectDescription } from "./records.ts";

export type ActionDescription = SystemDescription["actions"][number];

/** One control on a form. */
export interface FormField {
  key: string;
  label: string;
  type: string;
  /** The object a `ref` field points at. */
  target: string | null;
  required: boolean;
  /** A choice field's options. Null when the field isn't a choice. */
  options: FieldDescription["options"];
  /** A choice field's list, `config/choices/<list>.yaml`. Null otherwise. */
  list: string | null;
}

/** Values as the form holds them: text for inputs, booleans for checkboxes. */
export type FormValues = Record<string, string | boolean>;

/** Keys the screen fills in itself, never shown on a form. */
const filledIn = new Set(["id", "version", "customFields"]);

const generatedVerbs = new Set(["create", "update", "archive", "restore"]);

interface InputSchema {
  properties?: Record<string, { type?: string }>;
  required?: string[];
}

/** "moveToOrganisation" → "Move to organisation". */
export const humanise = (key: string) => {
  const words = key
    .replaceAll("_", " ")
    .replaceAll(/(?<lower>[a-z])(?<upper>[A-Z])/gu, "$1 $2");
  return words.charAt(0).toUpperCase() + words.slice(1).toLowerCase();
};

export const findAction = (
  description: SystemDescription | undefined,
  name: string
) => description?.actions.find((action) => action.name === name);

/**
 * What `name` does to `object`: `move_stage` for `deal_move_stage`, or for
 * the dotted names still in code, `moveStage` for `deal.moveStage`.
 */
export const verbOf = (name: string, object: string) =>
  ["_", "."].some((separator) => name.startsWith(`${object}${separator}`))
    ? name.slice(object.length + 1)
    : undefined;

/** The object's hand-written actions: `<object>_<verb>` beyond the generated ones. */
export const customActions = (
  description: SystemDescription | undefined,
  object: string
) =>
  (description?.actions ?? []).filter((action) => {
    const verb = verbOf(action.name, object);
    return verb !== undefined && !generatedVerbs.has(verb);
  });

/**
 * The controls a form for `action` shows, in the action's input order. An
 * input key that is one of the object's fields takes that field's label and
 * type, so `organisation` on `contact.moveToOrganisation` is a ref picker.
 * A generated create or update leaves out the fields the caller's roles
 * can't write (P2.14); a hand-written action takes what it takes.
 */
export const formFields = (
  action: ActionDescription,
  object: ObjectDescription
): FormField[] => {
  const schema = action.input as InputSchema;
  const required = new Set(schema.required);
  const verb = verbOf(action.name, object.name);
  const generated = verb !== undefined && generatedVerbs.has(verb);
  const unwritable = (key: string) =>
    generated &&
    object.fields.some((field) => field.key === key && field.write === false);
  return Object.entries(schema.properties ?? {})
    .filter(([key]) => !filledIn.has(key) && !unwritable(key))
    .map(([key, property]) => {
      const field: FieldDescription | undefined = object.fields.find(
        (each) => each.key === key
      );
      return {
        key,
        label: field?.label ?? humanise(key),
        type: field?.type ?? (property.type === "boolean" ? "boolean" : "text"),
        target: field?.target ?? null,
        required: required.has(key),
        options: field?.options ?? null,
        list: field?.list ?? null,
      };
    });
};

/** A record's values as a form holds them. */
export const toFormValues = (
  fields: FormField[],
  record: Record<string, unknown> = {}
): FormValues =>
  Object.fromEntries(
    fields.map((field): [string, string | boolean] => {
      const value = record[field.key];
      if (field.type === "boolean") {
        return [field.key, value === true];
      }
      if (value === null || value === undefined) {
        return [field.key, ""];
      }
      if (field.type === "money") {
        const money = value as { amount: number };
        return [field.key, String(money.amount / 100)];
      }
      return [field.key, String(value)];
    })
  );

const fromText = (
  field: FormField,
  text: string,
  previous: unknown
): unknown => {
  switch (field.type) {
    case "number": {
      return Number(text);
    }
    case "money": {
      const currency =
        (previous as { currency?: string } | null)?.currency ?? "GBP";
      return { amount: Math.round(Number(text) * 100), currency };
    }
    default: {
      return text;
    }
  }
};

/**
 * The action input from a form. With `record`, only changed fields go in and
 * a cleared field becomes null; without it, empty fields are left out.
 */
export const fromFormValues = (
  fields: FormField[],
  values: FormValues,
  record?: Record<string, unknown>
): Record<string, unknown> => {
  const before = record ? toFormValues(fields, record) : undefined;
  const input: Record<string, unknown> = {};
  for (const field of fields) {
    const value = values[field.key];
    if (value === undefined || (before && before[field.key] === value)) {
      continue;
    }
    if (typeof value === "boolean") {
      input[field.key] = value;
    } else if (value.trim() === "") {
      if (record) {
        input[field.key] = null;
      }
    } else {
      input[field.key] = fromText(field, value.trim(), record?.[field.key]);
    }
  }
  return input;
};

export type WorkflowDescription = SystemDescription["workflows"][number];

/**
 * The workflows that act on one `object` record (P2.18): those whose input
 * takes a record of it, with the input field the record fills.
 */
export const recordWorkflows = (
  description: SystemDescription | undefined,
  object: string
) =>
  (description?.workflows ?? []).flatMap((workflow) => {
    const field = workflow.fields.find(
      (each) => each.type === "ref" && each.target === object
    );
    return field && !workflow.readOnly
      ? [{ workflow, recordKey: field.key }]
      : [];
  });

/** The controls a workflow's form shows: its input but `recordKey`. */
export const workflowFormFields = (
  workflow: WorkflowDescription,
  recordKey?: string
): FormField[] =>
  workflow.fields
    .filter((field) => field.key !== recordKey)
    .map(({ key, label, type, target, required, options, list }) => ({
      key,
      label,
      type,
      target,
      required,
      options,
      list,
    }));
