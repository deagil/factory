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
const sortableTypes = new Set([
  "text",
  "email",
  "url",
  "number",
  "money",
  "date",
  "boolean",
]);

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

/** The field a reference shows: the display field, or the first text field. */
export const displayFieldOf = (object: ObjectDescription | undefined) =>
  object?.fields.find((field) => field.display) ??
  object?.fields.find((field) => field.type === "text");

/**
 * A URL for the image shown before the display value, when the record has one.
 * Image fields are not built yet; a stored http(s) or site-relative value is
 * ready for them.
 */
export const avatarSrc = (
  record: Record<string, unknown> | undefined,
  object: ObjectDescription | undefined
): string | null => {
  const key = object?.fields.find((field) => field.display)?.avatar;
  const value = key && record ? record[key] : undefined;
  if (typeof value !== "string" || value === "") {
    return null;
  }
  return value.startsWith("/") || /^https?:\/\//iu.test(value) ? value : null;
};

/** The avatar that leads `field` when it is a ref or the record's display field. */
export const leadingSrc = (
  field: FieldDescription,
  record: Record<string, unknown>,
  related: Related,
  description: SystemDescription | undefined,
  object: ObjectDescription | undefined
): string | null => {
  if (field.type === "ref") {
    const target = related[field.key]?.[String(record[field.key] ?? "")];
    return avatarSrc(target, findObject(description, field.target ?? ""));
  }
  return field.display ? avatarSrc(record, object) : null;
};

/** How many minor-unit digits a currency has: 2 for GBP, 0 for JPY. */
export const minorDigits = (currency: string): number =>
  new Intl.NumberFormat("en", {
    style: "currency",
    currency,
  }).resolvedOptions().maximumFractionDigits ?? 2;

/** The currency's narrow symbol, such as £, for an input's prefix. */
export const currencySymbol = (currency: string): string =>
  new Intl.NumberFormat("en-GB", {
    style: "currency",
    currency,
    currencyDisplay: "narrowSymbol",
  })
    .formatToParts(0)
    .find((part) => part.type === "currency")?.value ?? currency;

/**
 * Major units for an input, with the currency's decimal places always
 * shown: 1_200_000 GBP is "12000.00", so the box can't be read as pence.
 */
export const moneyInputText = (value: {
  amount: number;
  currency: string;
}): string => {
  const digits = minorDigits(value.currency);
  return (value.amount / 10 ** digits).toFixed(digits);
};

/** Minor units from text typed in major units. */
export const moneyFromInput = (text: string, currency: string) => ({
  amount: Math.round(Number(text) * 10 ** minorDigits(currency)),
  currency,
});

const formatMoney = (value: { amount: number; currency: string }) =>
  new Intl.NumberFormat("en-GB", {
    style: "currency",
    currency: value.currency,
  }).format(value.amount / 10 ** minorDigits(value.currency));

/** A field's own value as text. A ref has no text of its own. */
const plainValue = (
  field: FieldDescription,
  record: Record<string, unknown>
): string => {
  const value = record[field.key];
  if (value === null || value === undefined) {
    return "";
  }
  switch (field.type) {
    case "ref": {
      return "";
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
    case "url": {
      return String(value).replace(/^https?:\/\//iu, "");
    }
    case "number": {
      return (value as number).toLocaleString("en-GB");
    }
    default: {
      return String(value);
    }
  }
};

/** What a record is called: its display field, or an actor's name. */
export const titleOf = (
  record: Record<string, unknown> | undefined,
  object: ObjectDescription | undefined
): string => {
  if (!record) {
    return "";
  }
  const field = displayFieldOf(object);
  const shown = field ? plainValue(field, record) : "";
  if (shown !== "") {
    return shown;
  }
  const { name } = record;
  if (typeof name === "string" && name !== "") {
    return name;
  }
  return record.id === undefined ? "" : String(record.id);
};

/** A field's value as text, following refs into `related`. */
export const displayValue = (
  field: FieldDescription,
  record: Record<string, unknown>,
  related: Related,
  description: SystemDescription | undefined
): string => {
  if (field.type !== "ref") {
    return plainValue(field, record);
  }
  const value = record[field.key];
  if (value === null || value === undefined) {
    return "";
  }
  const target = related[field.key]?.[String(value)];
  return target
    ? titleOf(target, findObject(description, field.target ?? ""))
    : String(value);
};

export const isMoney = (
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
    return moneyInputText(value);
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
      return moneyFromInput(text, "GBP");
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
