// Filter operators shared by the field types, and the two functions the data
// access layer (P1.04) uses: one validates a filter, the other turns it into
// a condition.
//
// A filter on one field is an object of operators, such as
// `{ gte: 10, lt: 20 }`. Every operator in it must hold.

import {
  and,
  eq,
  gt,
  gte,
  inArray,
  isNotNull,
  isNull,
  lt,
  lte,
  ne,
} from "drizzle-orm";
import type { SQL } from "drizzle-orm";
import type { PgColumn } from "drizzle-orm/pg-core";
import { z } from "zod";

import type {
  AnyField,
  BuiltColumns,
  FieldColumns,
  FilterOperator,
  MainColumn,
} from "./field.ts";

/** The most values an `in` filter takes. */
export const maxInValues = 100;

// Operators on one column work for any field that has a main column.
type AnyMainColumn = MainColumn<FieldColumns[string]>;

const main = (columns: BuiltColumns<AnyMainColumn>): PgColumn => columns[""];

/** An operator on a field's main column. */
export const operator = <TSchema extends z.ZodType>(
  value: TSchema,
  where: (column: PgColumn, value: z.output<TSchema>) => SQL
): FilterOperator<AnyMainColumn, TSchema> => ({
  value,
  where: (columns, v) => where(main(columns), v),
});

/** `isNull: true` matches empty fields, `isNull: false` filled ones. */
export const isNullOperator = (): FilterOperator<AnyMainColumn, z.ZodBoolean> =>
  operator(z.boolean(), (column, value) =>
    value ? isNull(column) : isNotNull(column)
  );

/** `eq`, `ne` and `in` for a value schema. */
export const equalityOperators = <TSchema extends z.ZodType>(
  value: TSchema
) => ({
  eq: operator(value, (column, v) => eq(column, v)),
  ne: operator(value, (column, v) => ne(column, v)),
  in: operator(z.array(value).min(1).max(maxInValues), (column, v) =>
    inArray(column, v)
  ),
});

/** `gt`, `gte`, `lt` and `lte` for a value schema. */
export const rangeOperators = <TSchema extends z.ZodType>(value: TSchema) => ({
  gt: operator(value, (column, v) => gt(column, v)),
  gte: operator(value, (column, v) => gte(column, v)),
  lt: operator(value, (column, v) => lt(column, v)),
  lte: operator(value, (column, v) => lte(column, v)),
});

/** Escapes `%`, `_` and `\` so a search matches them literally. */
export const escapeLike = (value: string): string =>
  value.replaceAll(/[\\%_]/gu, (char) => `\\${char}`);

/**
 * The schema for a filter on `field`: an object of its operators, at least
 * one, with no unknown ones.
 */
export const filterSchema = (field: AnyField) => {
  const shape: Record<string, z.ZodOptional<z.ZodType>> = {};
  for (const [name, op] of Object.entries(field.filters)) {
    shape[name] = (op as FilterOperator<FieldColumns>).value.optional();
  }
  return z
    .strictObject(shape)
    .refine((filter) => Object.values(filter).some((v) => v !== undefined), {
      message: "A filter needs at least one operator",
    });
};

/**
 * The condition for a filter that `filterSchema(field)` has already parsed.
 * Throws on an unknown operator, which a parsed filter never has.
 */
export const filterWhere = (
  field: AnyField,
  columns: BuiltColumns<FieldColumns>,
  filter: Record<string, unknown>
): SQL => {
  const conditions: SQL[] = [];
  for (const [name, value] of Object.entries(filter)) {
    if (value === undefined) {
      continue;
    }
    const op = (field.filters as Record<string, FilterOperator<FieldColumns>>)[
      name
    ];
    if (!op) {
      throw new Error(`The ${field.kind} field has no "${name}" filter`);
    }
    conditions.push(op.where(columns, value));
  }
  const condition = and(...conditions);
  if (!condition) {
    throw new Error("A filter needs at least one operator");
  }
  return condition;
};
