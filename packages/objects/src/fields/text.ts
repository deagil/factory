import { ilike } from "drizzle-orm";
import { text as textColumn } from "drizzle-orm/pg-core";
import type { PgTextBuilderInitial } from "drizzle-orm/pg-core";
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
  escapeLike,
  isNullOperator,
  operator,
} from "./filters.ts";

export interface TextOptions<
  TRequired extends boolean,
> extends FieldOptions<TRequired> {
  /** The most characters the field takes, after trimming. */
  maxLength?: number;
}

type TextColumns<TRequired extends boolean> = MainColumn<
  RequiredColumn<PgTextBuilderInitial<string, [string, ...string[]]>, TRequired>
>;

const textFilters = {
  ...equalityOperators(z.string()),
  contains: operator(z.string().min(1), (column, value) =>
    ilike(column, `%${escapeLike(value)}%`)
  ),
  startsWith: operator(z.string().min(1), (column, value) =>
    ilike(column, `${escapeLike(value)}%`)
  ),
  isNull: isNullOperator(),
};

export type TextField<TRequired extends boolean = boolean> = Field<
  "text",
  string,
  TRequired,
  TextColumns<TRequired>,
  typeof textFilters
>;

/**
 * Text, stored as `text`. Input is trimmed; a required field can't be empty.
 * `contains` and `startsWith` ignore case.
 */
export const text = <TRequired extends boolean = false>(
  options?: TextOptions<TRequired>
): TextField<TRequired> => {
  const base = baseOptions(options);
  let value = z.string().trim();
  if (base.required) {
    value = value.min(1);
  }
  if (options?.maxLength !== undefined) {
    value = value.max(options.maxLength);
  }
  return {
    kind: "text",
    ...base,
    columns: (name) => ({
      "": requiredColumn(textColumn(name), base.required),
    }),
    toColumns: (v) => ({ "": v }),
    fromColumns: (row) => mainValue(row),
    input: orNull(value, base.required),
    output: orNull(z.string(), base.required),
    display: (v) => v ?? "",
    filters: textFilters,
  };
};
