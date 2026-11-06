import { date as dateColumn } from "drizzle-orm/pg-core";
import type { PgDateStringBuilderInitial } from "drizzle-orm/pg-core";
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

type DateColumns<TRequired extends boolean> = MainColumn<
  RequiredColumn<PgDateStringBuilderInitial<string>, TRequired>
>;

/** A calendar date as `YYYY-MM-DD`, checked to be a real day. */
const isoDate = z.iso.date();

const dateFilters = {
  ...equalityOperators(isoDate),
  ...rangeOperators(isoDate),
  isNull: isNullOperator(),
};

export type DateField<TRequired extends boolean = boolean> = Field<
  "date",
  string,
  TRequired,
  DateColumns<TRequired>,
  typeof dateFilters
>;

/**
 * A calendar date with no time or time zone, such as a close date or a
 * birthday. Stored as `date`; values are `YYYY-MM-DD` strings, which sort and
 * compare as dates.
 */
export const date = <TRequired extends boolean = false>(
  options?: FieldOptions<TRequired>
): DateField<TRequired> => {
  const base = baseOptions(options);
  return {
    kind: "date",
    ...base,
    columns: (name) => ({
      "": requiredColumn(dateColumn(name, { mode: "string" }), base.required),
    }),
    toColumns: (v) => ({ "": v }),
    fromColumns: (row) => mainValue(row),
    input: orNull(isoDate, base.required),
    output: orNull(z.string(), base.required),
    display: (v) => v ?? "",
    filters: dateFilters,
  };
};
