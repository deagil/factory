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

export interface UrlOptions<
  TRequired extends boolean,
> extends FieldOptions<TRequired> {
  /** The most characters the address takes, after a missing scheme is added. Defaults to 2048. */
  maxLength?: number;
}

type UrlColumns<TRequired extends boolean> = MainColumn<
  RequiredColumn<PgTextBuilderInitial<string, [string, ...string[]]>, TRequired>
>;

const urlFilters = {
  ...equalityOperators(z.string()),
  contains: operator(z.string().min(1), (column, value) =>
    ilike(column, `%${escapeLike(value)}%`)
  ),
  startsWith: operator(z.string().min(1), (column, value) =>
    ilike(column, `${escapeLike(value)}%`)
  ),
  isNull: isNullOperator(),
};

export type UrlField<TRequired extends boolean = boolean> = Field<
  "url",
  string,
  TRequired,
  UrlColumns<TRequired>,
  typeof urlFilters
>;

/** A scheme, as in `https:`. Anything else is treated as a host. */
const hasScheme = /^[a-z][a-z0-9+.-]*:/iu;

/** What a screen shows: the address without an `http` or `https` prefix. */
export const urlWithoutScheme = (value: string) =>
  value.replace(/^https?:\/\//iu, "");

const defaultMaxLength = 2048;

/**
 * An http or https address, stored as `text`. A value with no scheme is
 * stored as `https`. Output only checks the shape, so an older value still
 * reads. Display drops the `http` prefix. Filters match text.
 */
export const url = <TRequired extends boolean = false>(
  options?: UrlOptions<TRequired>
): UrlField<NoInfer<TRequired>> => {
  const base = baseOptions(options);
  let value = z.string().trim();
  if (base.required) {
    value = value.min(1);
  }
  const address = value
    .transform((text) => (hasScheme.test(text) ? text : `https://${text}`))
    .pipe(z.httpUrl().max(options?.maxLength ?? defaultMaxLength));
  return {
    kind: "url",
    ...base,
    columns: (name) => ({
      "": requiredColumn(textColumn(name), base.required),
    }),
    toColumns: (v) => ({ "": v }),
    fromColumns: (row) => mainValue(row),
    input: orNull(address, base.required),
    output: orNull(z.string(), base.required),
    display: (v) => (v ? urlWithoutScheme(v) : ""),
    filters: urlFilters,
  };
};
