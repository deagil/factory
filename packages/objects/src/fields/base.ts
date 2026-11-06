// Helpers the field types share.

import type { PgColumnBuilderBase } from "drizzle-orm/pg-core";
import type { z } from "zod";

import type { FieldOptions, RequiredColumn } from "./field.ts";

/** The options every field keeps, with `required` defaulting to false. */
export const baseOptions = <TRequired extends boolean = false>(
  options: FieldOptions<TRequired> | undefined
) => ({
  required: (options?.required ?? false) as TRequired,
  label: options?.label,
  description: options?.description,
});

/** Marks a builder NOT NULL when the field is required. */
export const requiredColumn = <
  TBuilder extends PgColumnBuilderBase & { notNull: () => unknown },
  TRequired extends boolean,
>(
  builder: TBuilder,
  required: TRequired
): RequiredColumn<TBuilder, TRequired> =>
  (required ? builder.notNull() : builder) as RequiredColumn<
    TBuilder,
    TRequired
  >;

/** A value schema that also takes null when the field isn't required. */
export const orNull = <TSchema extends z.ZodType, TRequired extends boolean>(
  schema: TSchema,
  required: TRequired
) =>
  (required ? schema : schema.nullable()) as unknown as z.ZodType<
    TRequired extends true ? z.output<TSchema> : z.output<TSchema> | null
  >;

/** Reads a field's main column. */
export const mainValue = <T>(row: { "": unknown }): T => row[""] as T;
