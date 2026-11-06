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

const numberFilters = {
  ...equalityOperators(z.number()),
  ...rangeOperators(z.number()),
  isNull: isNullOperator(),
};

export type NumberField<
  TRequired extends boolean = boolean,
  TInteger extends boolean = boolean,
> = Field<
  "number",
  number,
  TRequired,
  NumberColumns<TRequired, TInteger>,
  typeof numberFilters
>;

/** Postgres `integer` limits, which an integer field's input must keep to. */
const int32 = { min: -2_147_483_648, max: 2_147_483_647 };

/**
 * A number. Quantities, scores and percentages; use money for amounts of
 * money. Plain display uses no grouping and no rounding.
 */
export const number = <
  TRequired extends boolean = false,
  TInteger extends boolean = false,
>(
  options?: NumberOptions<TRequired, TInteger>
): NumberField<TRequired, TInteger> => {
  const base = baseOptions(options);
  const isInteger = options?.integer ?? false;
  let value = isInteger ? z.int().min(int32.min).max(int32.max) : z.number();
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
    filters: numberFilters,
  };
};
