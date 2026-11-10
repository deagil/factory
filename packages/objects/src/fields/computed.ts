// A value calculated from other fields on the same record. It has no column:
// reads calculate it, and create and update never take it. The operations are
// a closed list in code (decision 0052). There is no expression language.

import { z } from "zod";

import { baseOptions } from "./base.ts";
import type { AnyField, Field, FieldOptions } from "./field.ts";

/** Operations a computed field can use. */
export const computedOperations = [
  "concat",
  "coalesce",
  "add",
  "subtract",
  "multiply",
] as const;

export type ComputedOperation = (typeof computedOperations)[number];

/** What a computed field returns. */
export type ComputedResult = "text" | "number";

const textOperations = new Set<ComputedOperation>(["concat", "coalesce"]);
const numberOperations = new Set<ComputedOperation>([
  "coalesce",
  "add",
  "subtract",
  "multiply",
]);

/** Stored fields a text result can read. */
export const textSourceKinds = new Set(["text", "email", "url"]);

export interface ComputedOptions<TResult extends ComputedResult> extends Omit<
  FieldOptions<false>,
  "required"
> {
  /** `text` or `number`: the shape reads return. */
  type: TResult;
  /** Which operation combines `fields`. */
  using: ComputedOperation;
  /** Other fields on this object, in order. At least two. */
  fields: readonly [string, string, ...string[]];
  /** Placed between the parts `concat` keeps. Defaults to a space. */
  separator?: string;
}

export type ComputedField<TResult extends ComputedResult = ComputedResult> =
  Field<
    "computed",
    string | number,
    false,
    Record<string, never>,
    Record<string, never>
  > & {
    /** `text` or `number`. */
    readonly result: TResult;
    readonly using: ComputedOperation;
    /** The fields this one reads, in order. */
    readonly sources: readonly string[];
    /** The separator `concat` uses. Null for every other operation. */
    readonly separator: string | null;
    /** The value from a record that already has the source fields. */
    readonly evaluate: (
      values: Record<string, unknown>
    ) => string | number | null;
  };

const fail = (message: string): never => {
  throw new Error(`f.computed: ${message}`);
};

const textAt = (values: Record<string, unknown>, key: string) => {
  const value = values[key];
  return typeof value === "string" && value !== "" ? value : null;
};

const numberAt = (values: Record<string, unknown>, key: string) => {
  const value = values[key];
  return typeof value === "number" && Number.isFinite(value) ? value : null;
};

const evaluate = (
  result: ComputedResult,
  using: ComputedOperation,
  sources: readonly string[],
  separator: string
) => {
  const calculate = (
    values: Record<string, unknown>
  ): string | number | null => {
    switch (using) {
      case "concat": {
        const parts = sources.flatMap((key) => {
          const part = textAt(values, key);
          return part === null ? [] : [part];
        });
        return parts.length > 0 ? parts.join(separator) : null;
      }
      case "coalesce": {
        for (const key of sources) {
          const value =
            result === "text" ? textAt(values, key) : numberAt(values, key);
          if (value !== null) {
            return value;
          }
        }
        return null;
      }
      case "add":
      case "subtract":
      case "multiply": {
        const numbers = sources.map((key) => numberAt(values, key));
        if (numbers.some((value) => value === null)) {
          return null;
        }
        const [first, ...rest] = numbers as number[];
        if (first === undefined) {
          return null;
        }
        if (using === "add") {
          return rest.reduce((total, value) => total + value, first);
        }
        if (using === "subtract") {
          return rest.reduce((total, value) => total - value, first);
        }
        return rest.reduce((total, value) => total * value, first);
      }
      default: {
        const unexpected: never = using;
        return unexpected;
      }
    }
  };
  return calculate;
};

/** True when `field` is computed, so its result is calculated on read. */
export const isComputedField = (field: AnyField): field is ComputedField =>
  field.kind === "computed" && "evaluate" in field;

/**
 * A field calculated from other fields on the same record. `concat` joins
 * text, email and url fields, skipping empty ones. `coalesce` returns the
 * first value that is present. `add`, `subtract` and `multiply` combine
 * numbers and return null when any of them is empty.
 */
export const computed = <TResult extends ComputedResult>(
  options: ComputedOptions<TResult>
): ComputedField<TResult> => {
  const base = baseOptions<false>({ ...options, required: false });
  const { type: result, using, fields } = options;
  const allowed = result === "text" ? textOperations : numberOperations;
  if (!allowed.has(using)) {
    fail(`${using} doesn't return ${result}`);
  }
  if (new Set(fields).size !== fields.length) {
    fail("fields must be named once each");
  }
  if (options.separator !== undefined && using !== "concat") {
    fail("separator is only for concat");
  }
  const separator = options.separator ?? " ";
  const output =
    result === "text" ? z.string().nullable() : z.number().nullable();
  return {
    kind: "computed",
    ...base,
    result,
    using,
    sources: fields,
    separator: using === "concat" ? separator : null,
    columns: () => ({}),
    toColumns: () => fail("a computed field can't be written"),
    fromColumns: () => fail("a computed field is calculated from the record"),
    input: z.never(),
    output,
    display: (value) => (value === null ? "" : String(value)),
    filters: {},
    evaluate: evaluate(result, using, fields, separator),
  };
};
