// The shape every field type shares. See docs/SYSTEM_DESIGN.md section 4.1
// and decision 0014.
//
// A field can own more than one column (money has an amount and a currency),
// so a field describes its columns as a map from a suffix to a Drizzle column
// builder. The main column has the suffix "". defineObject (P1.02) turns the
// field `value` with suffixes "" and "Currency" into the table properties
// `value` and `valueCurrency`.

import type { NotNull, SQL } from "drizzle-orm";
import type { PgColumn, PgColumnBuilderBase } from "drizzle-orm/pg-core";
import type { z } from "zod";

import type { ChoiceOptions } from "./choice.ts";

/** Options every field type takes. */
export interface FieldOptions<TRequired extends boolean = boolean> {
  /** The field must have a value: its columns are NOT NULL and input can't be null. */
  required?: TRequired;
  /** What people see. defineObject derives one from the key when it's missing. */
  label?: string;
  /** Shown to staff and agents next to the field. */
  description?: string;
  /**
   * This field's value is the record's name: what a reference shows, and the
   * record screen's title. An object has at most one.
   */
  displayField?: boolean;
  /**
   * An image field shown before the display value, such as a logo. Only the
   * display field names one. Image fields are not built yet.
   */
  avatar?: string;
}

/** A field's column builders, keyed by suffix. The main column's suffix is "". */
export type FieldColumns = Record<string, PgColumnBuilderBase>;

/**
 * A column map holding only the main column. Column maps are type aliases, not
 * interfaces, so they fit `FieldColumns`' index signature.
 */
export type MainColumn<TBuilder extends PgColumnBuilderBase> = Record<
  "",
  TBuilder
>;

/** The built columns for one field, keyed like its builders. */
export type BuiltColumns<TColumns extends FieldColumns> = {
  [S in keyof TColumns]: PgColumn;
};

/** A builder that is NOT NULL when the field is required. */
export type RequiredColumn<
  TBuilder extends PgColumnBuilderBase,
  TRequired extends boolean,
> = TRequired extends true ? NotNull<TBuilder> : TBuilder;

/** One filter operator: the value it takes and the condition it builds. */
export interface FilterOperator<
  TColumns extends FieldColumns,
  TSchema extends z.ZodType = z.ZodType,
> {
  readonly value: TSchema;
  readonly where: (
    columns: BuiltColumns<TColumns>,
    value: z.output<TSchema>,
    context?: FilterContext
  ) => SQL;
}

/** What a filter can read besides its value: the loaded choice options. */
export interface FilterContext {
  readonly choices?: ChoiceOptions | undefined;
}

/** The filter operators a field type supports, by name. */
export type FilterOperators<TColumns extends FieldColumns> = Record<
  string,
  // oxlint-disable-next-line typescript/no-explicit-any -- each operator takes its own value type
  FilterOperator<TColumns, any>
>;

/** A field value as stored: the type's value, or null when it isn't required. */
export type FieldValue<
  TValue,
  TRequired extends boolean,
> = TRequired extends true ? TValue : TValue | null;

export interface Field<
  TKind extends string,
  TValue,
  TRequired extends boolean,
  TColumns extends FieldColumns,
  TFilters extends FilterOperators<TColumns>,
> {
  readonly kind: TKind;
  readonly required: TRequired;
  readonly label: string | undefined;
  readonly description: string | undefined;
  /** Whether this field is the record's display field. */
  readonly displayField: boolean;
  /** The image field shown before the display value, when this field is it. */
  readonly avatar: string | undefined;
  /**
   * The Drizzle column builders for this field. `name` is the field's column
   * name in snake case; each builder's database name starts with it.
   */
  readonly columns: (name: string) => TColumns;
  /** Column values for a field value, keyed like `columns`. */
  readonly toColumns: (value: FieldValue<TValue, TRequired>) => {
    [S in keyof TColumns]: unknown;
  };
  /** The field value from a row's columns, keyed like `columns`. */
  readonly fromColumns: (row: {
    [S in keyof TColumns]: unknown;
  }) => FieldValue<TValue, TRequired>;
  /**
   * What a create or update may set the field to. It holds the type's rules
   * (length, range, currency), so it can be stricter than `output`.
   */
  readonly input: z.ZodType<FieldValue<TValue, TRequired>>;
  /**
   * What a read returns. It only checks the shape, so a record saved before a
   * rule was tightened still reads.
   */
  readonly output: z.ZodType<FieldValue<TValue, TRequired>>;
  /** A plain, locale-free string for lists, logs and agents. Null is "". */
  readonly display: (value: FieldValue<TValue, TRequired>) => string;
  readonly filters: TFilters;
}

/* oxlint-disable typescript/no-explicit-any -- AnyField is the widest
   field: its functions take any, so every field's narrower ones fit it. */
/** Any field, whatever its kind and value. */
export interface AnyField {
  readonly kind: string;
  readonly required: boolean;
  readonly label: string | undefined;
  readonly description: string | undefined;
  readonly displayField: boolean;
  readonly avatar: string | undefined;
  readonly columns: (name: string) => FieldColumns;
  readonly toColumns: (value: any) => Record<string, unknown>;
  readonly fromColumns: (row: any) => unknown;
  readonly input: z.ZodType;
  readonly output: z.ZodType;
  readonly display: (value: any) => string;
  readonly filters: Record<
    string,
    {
      readonly value: z.ZodType;
      readonly where: (columns: any, value: any, context?: any) => SQL;
    }
  >;
}
/* oxlint-enable typescript/no-explicit-any */

/** The value type a field holds, with null when it isn't required. */
export type ValueOf<TField extends AnyField> = z.output<TField["output"]>;

/** The operator names a field supports. */
export type OperatorOf<TField extends AnyField> = keyof TField["filters"] &
  string;
