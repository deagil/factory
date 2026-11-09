// Choice fields (P2.06, SYSTEM_DESIGN §4.5, decisions 0039 and 0040): a field
// that stores the key of one option from a list in `config/choices/<list>.yaml`.
//
// A list is defined in code with `defineChoiceList`: its key, its own columns
// (each a Zod schema), and, when code acts on specific options, its fixed
// keys. Every option also has the built-in columns: key, label, description
// and archived. Staff edit the rows in config; the structure stays in code.
//
// The repository checks each value against the options loaded for the run,
// and validateConfig checks each list's file against its definition.
import { isDeepStrictEqual } from "node:util";

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

/** A list or option key: lower case, digits and dashes. */
export const choiceKey = z
  .string()
  .regex(
    /^[a-z][a-z0-9]*(?:_[a-z0-9]+)*$/u,
    "Use snake_case: lower case letters and digits joined by single underscores, starting with a letter, such as public_sector"
  );

/** The columns every option has, whatever its list. */
export const choiceOptionShape = {
  key: choiceKey,
  label: z.string().min(1).max(200),
  /** Help text for tooltips, hints and agents. Plain text. */
  description: z.string().min(1).max(500).optional(),
  archived: z.boolean().optional(),
};

/**
 * Column names a list can't declare: the built-in ones, and names kept for
 * what the core may add (`color` for pills, `default` for a preselection).
 */
export const reservedChoiceColumns = [
  "key",
  "label",
  "description",
  "archived",
  "color",
  "default",
] as const;

/** One option, as `config/choices/<list>.yaml` holds it. */
export interface ChoiceOption {
  readonly key: string;
  readonly label: string;
  readonly description?: string | undefined;
  readonly archived?: boolean | undefined;
  /** The list's own columns. */
  readonly [column: string]: unknown;
}

/** The options loaded for a list, or undefined when there is no such list. */
export type ChoiceOptions = (
  list: string
) => readonly ChoiceOption[] | undefined;

/** A list's own columns: one Zod schema each. */
export type ChoiceColumns = Record<string, z.ZodType>;

/** A choice list: its key, its own columns and any keys code acts on. */
export interface ChoiceListDefinition<
  TKey extends string = string,
  TColumns extends ChoiceColumns = ChoiceColumns,
> {
  readonly key: string;
  /** Keys code acts on. The list must have exactly these, none archived. */
  readonly keys: readonly TKey[] | undefined;
  readonly columns: TColumns;
  /** One option as the file must hold it: built-in columns and the list's own. */
  readonly option: z.ZodObject;
}

// oxlint-disable-next-line typescript/no-explicit-any -- any list, whatever its columns.
export type AnyChoiceList = ChoiceListDefinition<string, any>;

/** One option of `TList`, with its columns typed. */
export type OptionOf<TList extends AnyChoiceList> =
  TList extends ChoiceListDefinition<infer TKey, infer TColumns>
    ? {
        readonly key: TKey;
        readonly label: string;
        readonly description?: string | undefined;
        readonly archived?: boolean | undefined;
      } & Readonly<z.output<z.ZodObject<TColumns>>>
    : ChoiceOption;

const columnName = /^[a-z][a-zA-Z0-9]*$/u;

/**
 * Defines a choice list. `columns` are the list's own, each with a Zod
 * schema; `keys`, when given, are the keys code acts on.
 */
export const defineChoiceList = <
  const TKey extends string = string,
  const TColumns extends ChoiceColumns = Record<never, never>,
>(options: {
  key: string;
  keys?: readonly [TKey, ...TKey[]];
  columns?: TColumns;
}): ChoiceListDefinition<TKey, TColumns> => {
  const fail = (message: string): never => {
    throw new Error(`defineChoiceList("${options.key}"): ${message}`);
  };
  if (!choiceKey.safeParse(options.key).success) {
    fail("the key must be lower case letters, digits and dashes");
  }
  for (const key of options.keys ?? []) {
    if (!choiceKey.safeParse(key).success) {
      fail(`"${key}" isn't a valid option key`);
    }
  }
  const columns = (options.columns ?? {}) as TColumns;
  for (const name of Object.keys(columns)) {
    if ((reservedChoiceColumns as readonly string[]).includes(name)) {
      fail(
        `"${name}" is reserved (${reservedChoiceColumns.join(", ")}). Name the column something else.`
      );
    }
    if (!columnName.test(name)) {
      fail(`the column "${name}" must be camelCase`);
    }
  }
  return Object.freeze({
    key: options.key,
    keys: options.keys ? [...options.keys] : undefined,
    columns,
    option: z.strictObject({ ...choiceOptionShape, ...columns }),
  });
};

type ChoiceFieldColumns<TRequired extends boolean> = MainColumn<
  RequiredColumn<PgTextBuilderInitial<string, [string, ...string[]]>, TRequired>
>;

type WhereOperator = FilterOperator<ChoiceFieldColumns<boolean>, z.ZodType>;

/**
 * `where`: the options whose columns have these values, such as
 * `{ category: "open" }`, read from the loaded list. Archived options count,
 * since records may still hold them.
 */
const whereOperator = (list: AnyChoiceList): WhereOperator => ({
  value: z
    .strictObject(
      Object.fromEntries(
        Object.entries(list.columns as ChoiceColumns).map(([name, schema]) => [
          name,
          schema.optional(),
        ])
      )
    )
    .refine((match) => Object.keys(match).length > 0, "Name a column"),
  where: (columns, match, context) => {
    const keys = (context?.choices?.(list.key) ?? [])
      .filter((option) =>
        Object.entries(match as Record<string, unknown>).every(
          ([name, value]) => isDeepStrictEqual(option[name], value)
        )
      )
      .map((option) => option.key);
    return keys.length > 0 ? inArray(columns[""], keys) : sql`false`;
  },
});

const keyFilters = {
  ...equalityOperators(choiceKey),
  isNull: isNullOperator(),
};

export type ChoiceField<
  TValue extends string = string,
  TRequired extends boolean = boolean,
  TList extends AnyChoiceList = AnyChoiceList,
> = Field<
  "choice",
  TValue,
  TRequired,
  ChoiceFieldColumns<TRequired>,
  typeof keyFilters & { where?: WhereOperator }
> & {
  /** The list the options come from. */
  readonly list: TList;
};

/** The keys a list's field takes: its fixed keys, or any key. */
type KeyOf<TList extends AnyChoiceList> =
  TList extends ChoiceListDefinition<infer TKey> ? TKey : string;

/**
 * A choice of one option from `list`, stored as the option's key in a text
 * column. A list with fixed keys takes only those.
 */
export const choice = <
  TList extends AnyChoiceList,
  TRequired extends boolean = false,
>(
  list: TList,
  options: FieldOptions<TRequired> = {}
): ChoiceField<KeyOf<TList>, NoInfer<TRequired>, TList> => {
  const base = baseOptions(options);
  const value = list.keys
    ? z.enum(list.keys as unknown as [string, ...string[]])
    : choiceKey;
  const field: ChoiceField<string, TRequired, TList> = {
    kind: "choice",
    list,
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
      Object.keys(list.columns).length > 0
        ? { ...keyFilters, where: whereOperator(list) }
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
  const list = options.choices?.(field.list.key);
  if (!list) {
    throw new ChoiceValueError(
      key,
      `There are no options for ${key}: config/choices/${field.list.key}.yaml isn't loaded.`
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
