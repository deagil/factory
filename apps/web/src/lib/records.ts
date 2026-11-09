// Generic record helpers for the generated screens: everything comes from
// system.describe, so no screen code is specific to one object (P1.20).
import type { SystemDescription } from "./api.ts";

export type ObjectDescription = SystemDescription["objects"][number];
export type FieldDescription = ObjectDescription["fields"][number];
export type Related = Record<string, Record<string, Record<string, unknown>>>;
export type Filter = Record<string, Record<string, unknown>>;

export interface ListPage {
  records: Record<string, unknown>[];
  nextCursor: string | null;
  related: Related;
}

/** Field types the list query can sort by (with createdAt and updatedAt). */
const sortableTypes = new Set(["text", "number", "money", "date", "boolean"]);

export const isSortable = (field: FieldDescription) =>
  sortableTypes.has(field.type);

export const findObject = (
  description: SystemDescription | undefined,
  name: string
) => description?.objects.find((object) => object.name === name);

/** The fields the caller's roles let them see (P2.14). */
export const readableFields = (object: ObjectDescription) =>
  object.fields.filter((field) => field.read !== false);

/** The fields a list shows, in order: the object's `list`, less hidden ones. */
export const columnsOf = (object: ObjectDescription): FieldDescription[] =>
  object.list
    .map((key) => readableFields(object).find((field) => field.key === key))
    .filter((field): field is FieldDescription => field !== undefined);

/** Ref fields among `fields` whose targets the list should fetch. */
export const expandable = (fields: FieldDescription[]) =>
  fields.filter((field) => field.type === "ref").map((field) => field.key);

/** "-name" → name descending; clicking the same column flips it. */
export const nextSort = (current: string | undefined, key: string) =>
  current === key ? `-${key}` : key;

/** What a record is called: its first text field, or an actor's name. */
export const titleOf = (
  record: Record<string, unknown> | undefined,
  object: ObjectDescription | undefined
): string => {
  if (!record) {
    return "";
  }
  const key =
    object?.fields.find((field) => field.type === "text")?.key ?? "name";
  const value = record[key];
  return typeof value === "string" && value !== "" ? value : String(record.id);
};

const formatMoney = (value: { amount: number; currency: string }) => {
  const format = new Intl.NumberFormat("en-GB", {
    style: "currency",
    currency: value.currency,
  });
  const digits = format.resolvedOptions().maximumFractionDigits ?? 2;
  return format.format(value.amount / 10 ** digits);
};

/** A field's value as text, following refs into `related`. */
export const displayValue = (
  field: FieldDescription,
  record: Record<string, unknown>,
  related: Related,
  description: SystemDescription | undefined
): string => {
  const value = record[field.key];
  if (value === null || value === undefined) {
    return "";
  }
  switch (field.type) {
    case "ref": {
      const target = related[field.key]?.[String(value)];
      return target
        ? titleOf(target, findObject(description, field.target ?? ""))
        : String(value);
    }
    case "money": {
      return formatMoney(value as { amount: number; currency: string });
    }
    case "boolean": {
      return value ? "Yes" : "No";
    }
    case "choice": {
      return (
        field.options?.find((option) => option.key === value)?.label ??
        String(value)
      );
    }
    case "number": {
      return (value as number).toLocaleString("en-GB");
    }
    default: {
      return String(value);
    }
  }
};

const isMoney = (
  value: unknown
): value is { amount: number; currency: string } =>
  typeof value === "object" &&
  value !== null &&
  "amount" in value &&
  typeof value.amount === "number";

/** The text a filter chip edits, the inverse of `filterValue`. */
export const filterText = (
  field: FieldDescription | undefined,
  op: string,
  value: unknown
): string => {
  if (op === "isNull") {
    return "";
  }
  if (op === "where" || Array.isArray(value)) {
    return JSON.stringify(value);
  }
  if (field?.type === "money" && isMoney(value)) {
    const major = value.amount / 100;
    return Number.isInteger(major) ? String(major) : major.toFixed(2);
  }
  if (
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "boolean"
  ) {
    return String(value);
  }
  return "";
};

/** Turns a filter's typed-in text into the value its field expects. */
export const filterValue = (field: FieldDescription, text: string): unknown => {
  switch (field.type) {
    case "number": {
      return Number(text);
    }
    case "boolean": {
      return text === "true";
    }
    case "money": {
      return { amount: Math.round(Number(text) * 100), currency: "GBP" };
    }
    default: {
      return text;
    }
  }
};

/** `filter` without one field's operator, dropping the field if it's left empty. */
export const withoutFilter = (
  filter: Filter,
  fieldKey: string,
  op: string
): Filter =>
  Object.fromEntries(
    Object.entries(filter)
      .map(([key, ops]): [string, Record<string, unknown>] => [
        key,
        key === fieldKey
          ? Object.fromEntries(
              Object.entries(ops).filter(([name]) => name !== op)
            )
          : ops,
      ])
      .filter(([, ops]) => Object.keys(ops).length > 0)
  );
