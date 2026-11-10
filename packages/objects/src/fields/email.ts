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

export interface EmailOptions<
  TRequired extends boolean,
> extends FieldOptions<TRequired> {
  /** The most characters the address takes, after trimming. Defaults to 320. */
  maxLength?: number;
}

type EmailColumns<TRequired extends boolean> = MainColumn<
  RequiredColumn<PgTextBuilderInitial<string, [string, ...string[]]>, TRequired>
>;

const emailFilters = {
  ...equalityOperators(z.string()),
  contains: operator(z.string().min(1), (column, value) =>
    ilike(column, `%${escapeLike(value)}%`)
  ),
  startsWith: operator(z.string().min(1), (column, value) =>
    ilike(column, `${escapeLike(value)}%`)
  ),
  isNull: isNullOperator(),
};

export type EmailField<TRequired extends boolean = boolean> = Field<
  "email",
  string,
  TRequired,
  EmailColumns<TRequired>,
  typeof emailFilters
>;

/** RFC 5321's limit: 64 characters, @, then 255. */
const defaultMaxLength = 320;

/**
 * An email address, stored as `text`. Input is trimmed, then checked as an
 * address. Output only checks the shape, so an older value still reads.
 * Filters match text.
 */
export const email = <TRequired extends boolean = false>(
  options?: EmailOptions<TRequired>
): EmailField<NoInfer<TRequired>> => {
  const base = baseOptions(options);
  let value = z
    .string()
    .trim()
    .max(options?.maxLength ?? defaultMaxLength);
  if (base.required) {
    value = value.min(1);
  }
  return {
    kind: "email",
    ...base,
    columns: (name) => ({
      "": requiredColumn(textColumn(name), base.required),
    }),
    toColumns: (v) => ({ "": v }),
    fromColumns: (row) => mainValue(row),
    input: orNull(value.pipe(z.email()), base.required),
    output: orNull(z.string(), base.required),
    display: (v) => v ?? "",
    filters: emailFilters,
  };
};
