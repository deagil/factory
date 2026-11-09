import { doublePrecision, integer as integerColumn } from "drizzle-orm/pg-core";
import type {
  PgDoublePrecisionBuilderInitial,
  PgIntegerBuilderInitial,
} from "drizzle-orm/pg-core";
import { z } from "zod";

import { baseOptions, mainValue, orNull, requiredColumn } from "./base.ts";
import type {
  Field,
  FieldOptions,
  MainColumn,
  RequiredColumn,
} from "./field.ts";
import {
  equalityOperators,
  isNullOperator,
  rangeOperators,
} from "./filters.ts";

export interface NumberOptions<
  TRequired extends boolean,
  TInteger extends boolean,
> extends FieldOptions<TRequired> {
  /** Whole numbers only, stored as `integer`. Otherwise `double precision`. */
  integer?: TInteger;
  min?: number;
  max?: number;
}

type NumberColumns<
  TRequired extends boolean,
  TInteger extends boolean,
> = MainColumn<
  RequiredColumn<
    TInteger extends true
      ? PgIntegerBuilderInitial<string>
      : PgDoublePrecisionBuilderInitial<string>,
    TRequired
  >
>;

/** Postgres `integer` limits, which an integer field's values must keep to. */
export const int32Schema = z.int().min(-2_147_483_648).max(2_147_483_647);

const filtersFor = (value: z.ZodNumber) => ({
  ...equalityOperators(value),
  ...rangeOperators(value),
  isNull: isNullOperator(),
});

const numberFilters = filtersFor(z.number());
const integerFilters = filtersFor(int32Schema);

export type NumberField<
  TRequired extends boolean = boolean,
  TInteger extends boolean = boolean,
> = Field<
  "number",
  number,
  TRequired,
  NumberColumns<TRequired, TInteger>,
  TInteger extends true ? typeof integerFilters : typeof numberFilters
> & { readonly integer: TInteger };

/**
 * A number. Quantities, scores and percentages; use money for amounts of
 * money. Plain display uses no grouping and no rounding.
 */
export const number = <
  TRequired extends boolean = false,
  TInteger extends boolean = false,
>(
  options?: NumberOptions<TRequired, TInteger>
): NumberField<NoInfer<TRequired>, NoInfer<TInteger>> => {
  const base = baseOptions(options);
  const isInteger = options?.integer ?? false;
  let value = isInteger ? int32Schema : z.number();
  if (options?.min !== undefined) {
    value = value.min(options.min);
  }
  if (options?.max !== undefined) {
    value = value.max(options.max);
  }
  return {
    kind: "number",
    ...base,
    columns: (name) =>
      ({
        "": requiredColumn(
          isInteger ? integerColumn(name) : doublePrecision(name),
          base.required
        ),
      }) as NumberColumns<TRequired, TInteger>,
    toColumns: (v) => ({ "": v }),
    fromColumns: (row) => mainValue(row),
    input: orNull(value, base.required),
    output: orNull(z.number(), base.required),
    display: (v) => (v === null ? "" : String(v)),
    integer: isInteger as TInteger,
    filters: (isInteger
      ? integerFilters
      : numberFilters) as TInteger extends true
      ? typeof integerFilters
      : typeof numberFilters,
  };
};
