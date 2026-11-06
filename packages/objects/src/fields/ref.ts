import { uuid } from "drizzle-orm/pg-core";
import type { PgUUIDBuilderInitial } from "drizzle-orm/pg-core";
import { z } from "zod";

import { baseOptions, mainValue, orNull, requiredColumn } from "./base.ts";
import type {
  Field,
  FieldOptions,
  MainColumn,
  RequiredColumn,
} from "./field.ts";
import { equalityOperators, isNullOperator } from "./filters.ts";

type RefColumns<TRequired extends boolean> = MainColumn<
  RequiredColumn<PgUUIDBuilderInitial<string>, TRequired>
>;

const refFilters = {
  ...equalityOperators(z.uuid()),
  isNull: isNullOperator(),
};

/**
 * What a ref can point at: another object, by name, or `actor` for the
 * core actors table.
 */
export type RefTarget = string;

export type RefField<
  TTarget extends RefTarget = RefTarget,
  TRequired extends boolean = boolean,
> = Field<
  "ref",
  string,
  TRequired,
  RefColumns<TRequired>,
  typeof refFilters
> & {
  /** The object this field points at, or `actor`. */
  readonly target: TTarget;
};

/**
 * A reference to one record of another object, or to an actor. Stored as a
 * `uuid` column named `<field>_id`, so the field `organisation` is the column
 * `organisation_id`. defineObject (P1.02) adds the foreign key, because only
 * it knows the target's table.
 */
export const ref = <
  TTarget extends RefTarget,
  TRequired extends boolean = false,
>(
  target: TTarget,
  options?: FieldOptions<TRequired>
): RefField<TTarget, TRequired> => {
  const base = baseOptions(options);
  return {
    kind: "ref",
    target,
    ...base,
    columns: (name) => ({
      "": requiredColumn(uuid(`${name}_id`), base.required),
    }),
    toColumns: (v) => ({ "": v }),
    fromColumns: (row) => mainValue(row),
    input: orNull(z.uuid(), base.required),
    output: orNull(z.string(), base.required),
    display: (v) => v ?? "",
    filters: refFilters,
  };
};
