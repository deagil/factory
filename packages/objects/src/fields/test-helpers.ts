// Test helpers for the field types: build a field's columns into a table and
// render the conditions its filters make.

import type { SQL } from "drizzle-orm";
import { PgDialect, getTableConfig, pgTable } from "drizzle-orm/pg-core";
import type { PgColumn } from "drizzle-orm/pg-core";

import type { AnyField, BuiltColumns, FieldColumns } from "./field.ts";
import { filterSchema, filterWhere } from "./filters.ts";

const dialect = new PgDialect();

/** Builds `field` as the column `name` of a table `t`. */
export const build = (field: AnyField, name = "value") => {
  const builders = field.columns(name);
  const table = pgTable("t", builders) as unknown as Record<string, PgColumn>;
  const columns: BuiltColumns<FieldColumns> = {};
  for (const suffix of Object.keys(builders)) {
    columns[suffix] = table[suffix] as PgColumn;
  }
  const config = getTableConfig(table as never);
  const shape = config.columns.map((column) => ({
    name: column.name,
    type: column.getSQLType(),
    notNull: column.notNull,
  }));
  return { columns, shape };
};

/** Renders a condition as SQL text and parameters. */
export const render = (condition: SQL) => {
  const { sql, params } = dialect.sqlToQuery(condition);
  return { sql, params };
};

/** Parses a filter for `field` and renders its condition. */
export const where = (field: AnyField, filter: Record<string, unknown>) => {
  const parsed = filterSchema(field).parse(filter);
  return render(filterWhere(field, build(field).columns, parsed));
};

/** Whether `filterSchema(field)` accepts `filter`. */
export const acceptsFilter = (
  field: AnyField,
  filter: Record<string, unknown>
): boolean => filterSchema(field).safeParse(filter).success;
