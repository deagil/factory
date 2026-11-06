import { eq } from "drizzle-orm";
import { boolean as booleanColumn } from "drizzle-orm/pg-core";
import type { PgBooleanBuilderInitial } from "drizzle-orm/pg-core";
import { z } from "zod";

import { baseOptions, mainValue, orNull, requiredColumn } from "./base.ts";
import type {
  Field,
  FieldOptions,
  MainColumn,
  RequiredColumn,
} from "./field.ts";
import { isNullOperator, operator } from "./filters.ts";

type BooleanColumns<TRequired extends boolean> = MainColumn<
  RequiredColumn<PgBooleanBuilderInitial<string>, TRequired>
>;

const booleanFilters = {
  eq: operator(z.boolean(), (column, value) => eq(column, value)),
  isNull: isNullOperator(),
};

export type BooleanField<TRequired extends boolean = boolean> = Field<
  "boolean",
  boolean,
  TRequired,
  BooleanColumns<TRequired>,
  typeof booleanFilters
>;

/** Yes or no, stored as `boolean`. A field that isn't required can be unset. */
export const boolean = <TRequired extends boolean = false>(
  options?: FieldOptions<TRequired>
): BooleanField<TRequired> => {
  const base = baseOptions(options);
  return {
    kind: "boolean",
    ...base,
    columns: (name) => ({
      "": requiredColumn(booleanColumn(name), base.required),
    }),
    toColumns: (v) => ({ "": v }),
    fromColumns: (row) => mainValue(row),
    input: orNull(z.boolean(), base.required),
    output: orNull(z.boolean(), base.required),
    display: (v) => {
      if (v === null) {
        return "";
      }
      return v ? "Yes" : "No";
    },
    filters: booleanFilters,
  };
};
