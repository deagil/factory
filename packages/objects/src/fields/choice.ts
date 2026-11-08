// Choice fields (P2.06, SYSTEM_DESIGN §4.5, decision 0006): a field that
// stores the key of one option from a list in `config/choices/<list>.yaml`.
// The field's `control` decides what staff may change in that list:
//
// - `system`: code acts on each key, so the keys are fixed here; staff only
//   rename labels.
// - `mapped`: code acts on categories, fixed here; staff add, rename,
//   reorder and archive options, each in one of those categories.
// - `custom`: code acts on nothing; staff own the list.
//
// The repository checks each value against the options loaded for the run,
// and validateConfig checks each list against the fields that use it.
import { inArray, sql } from "drizzle-orm";
import { text as textColumn } from "drizzle-orm/pg-core";
import type { PgTextBuilderInitial } from "drizzle-orm/pg-core";
import { z } from "zod";

import { baseOptions, mainValue, orNull, requiredColumn } from "./base.ts";
import type {
  Field,
  FieldOptions,
  FilterOperator,
  MainColumn,
  RequiredColumn,
} from "./field.ts";
import { equalityOperators, isNullOperator } from "./filters.ts";

export const choiceControls = ["system", "mapped", "custom"] as const;
export type ChoiceControl = (typeof choiceControls)[number];

/** A list or option key: lower case, digits and dashes. */
export const choiceKey = z
  .string()
  .regex(
    /^[a-z][a-z0-9-]*$/u,
    "Use lower case letters, digits and dashes, starting with a letter"
  );

/** One option, as `config/choices/<list>.yaml` holds it. */
export interface ChoiceOption {
  readonly key: string;
  readonly label: string;
  readonly category?: string | undefined;
  readonly archived?: boolean | undefined;
}

/** The options loaded for a list, or undefined when there is no such list. */
export type ChoiceOptions = (
  list: string
) => readonly ChoiceOption[] | undefined;

type ChoiceColumns<TRequired extends boolean> = MainColumn<
  RequiredColumn<PgTextBuilderInitial<string, [string, ...string[]]>, TRequired>
>;

/** A category filter: every option in the category, from the loaded list. */
const categoryOperator = (
  list: string
): FilterOperator<ChoiceColumns<boolean>, typeof choiceKey> => ({
  value: choiceKey,
  where: (columns, category, context) => {
    const keys = (context?.choices?.(list) ?? [])
      .filter((option) => option.category === category)
      .map((option) => option.key);
    return keys.length > 0 ? inArray(columns[""], keys) : sql`false`;
  },
});

const keyFilters = {
  ...equalityOperators(choiceKey),
  isNull: isNullOperator(),
};

interface ChoiceShape<TControl extends ChoiceControl> {
  /** The list under `config/choices/`. */
  readonly list: string;
  readonly control: TControl;
  /** `system`: the keys code acts on; the list must have exactly these. */
  readonly keys: readonly string[] | undefined;
  /** `mapped`: the categories code acts on; each option is in one. */
  readonly categories: readonly string[] | undefined;
}

export type ChoiceField<
  TValue extends string = string,
  TRequired extends boolean = boolean,
  TControl extends ChoiceControl = ChoiceControl,
> = Field<
  "choice",
  TValue,
  TRequired,
  ChoiceColumns<TRequired>,
  typeof keyFilters & {
    category?: FilterOperator<ChoiceColumns<boolean>, typeof choiceKey>;
  }
> &
  ChoiceShape<TControl>;

export type ChoiceOptionsFor<
  TControl extends ChoiceControl,
  TKeys extends string,
  TRequired extends boolean,
> = FieldOptions<TRequired> & { control: TControl } & (TControl extends "system"
    ? { keys: readonly [TKeys, ...TKeys[]] }
    : TControl extends "mapped"
      ? { categories: readonly [string, ...string[]] }
      : object);

/**
 * A choice of one option from `config/choices/<list>.yaml`, stored as the
 * option's key in a text column.
 */
export const choice = <
  TControl extends ChoiceControl,
  TKeys extends string = string,
  TRequired extends boolean = false,
>(
  list: string,
  options: ChoiceOptionsFor<TControl, TKeys, TRequired>
): ChoiceField<
  TControl extends "system" ? TKeys : string,
  NoInfer<TRequired>,
  TControl
> => {
  choiceKey.parse(list);
  const base = baseOptions(options);
  const keys = "keys" in options ? [...options.keys] : undefined;
  const categories =
    "categories" in options ? [...options.categories] : undefined;
  for (const key of [...(keys ?? []), ...(categories ?? [])]) {
    choiceKey.parse(key);
  }
  const value = keys
    ? z.enum(keys as unknown as [string, ...string[]])
    : choiceKey;
  const field: ChoiceField<string, TRequired, TControl> = {
    kind: "choice",
    list,
    control: options.control,
    keys,
    categories,
    ...base,
    columns: (name) => ({
      "": requiredColumn(textColumn(name), base.required),
    }),
    toColumns: (v) => ({ "": v }),
    fromColumns: (row) => mainValue(row),
    input: orNull(value, base.required),
    output: orNull(z.string(), base.required),
    display: (v) => v ?? "",
    filters:
      options.control === "mapped"
        ? { ...keyFilters, category: categoryOperator(list) }
        : keyFilters,
  };
  return field as never;
};

/** A value the loaded options don't allow; the pipeline makes it a validation error. */
export class ChoiceValueError extends Error {
  readonly field: string;

  constructor(field: string, message: string) {
    super(message);
    this.name = "ChoiceValueError";
    this.field = field;
  }
}

/**
 * Checks a value for a choice field against the loaded options. An archived
 * option is allowed only when it is the value the record already has.
 */
export const checkChoice = (
  key: string,
  field: ChoiceField,
  value: unknown,
  options: { choices?: ChoiceOptions | undefined; current?: unknown }
): void => {
  if (value === null || value === undefined) {
    return;
  }
  const list = options.choices?.(field.list);
  if (!list) {
    throw new ChoiceValueError(
      key,
      `There are no options for ${key}: config/choices/${field.list}.yaml isn't loaded.`
    );
  }
  const option = list.find((each) => each.key === value);
  if (!option) {
    throw new ChoiceValueError(
      key,
      `"${String(value)}" isn't an option for ${key}. Options: ${list
        .filter((each) => !each.archived)
        .map((each) => each.key)
        .join(", ")}.`
    );
  }
  if (option.archived && value !== options.current) {
    throw new ChoiceValueError(
      key,
      `"${String(value)}" is archived, so it can't be chosen for ${key}.`
    );
  }
};
