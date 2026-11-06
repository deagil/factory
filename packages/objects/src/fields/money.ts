import { and, eq, gt, gte, lt, lte, ne, or } from "drizzle-orm";
import type { SQL } from "drizzle-orm";
import { bigint, text } from "drizzle-orm/pg-core";
import type {
  PgBigInt53BuilderInitial,
  PgColumn,
  PgTextBuilderInitial,
} from "drizzle-orm/pg-core";
import { z } from "zod";

import { baseOptions, orNull, requiredColumn } from "./base.ts";
import type {
  BuiltColumns,
  Field,
  FieldOptions,
  FilterOperator,
  MainColumn,
  RequiredColumn,
} from "./field.ts";
import { isNullOperator } from "./filters.ts";

/** An amount of money in the currency's minor units, such as pence. */
export interface Money {
  /** A whole number of minor units: 1234 GBP is £12.34. */
  amount: number;
  /** An ISO 4217 code, such as GBP. */
  currency: string;
}

export interface MoneyOptions<
  TRequired extends boolean,
> extends FieldOptions<TRequired> {
  /** Only this currency is allowed. Otherwise any ISO 4217 currency is. */
  currency?: string;
}

type MoneyColumns<TRequired extends boolean> = MainColumn<
  RequiredColumn<PgBigInt53BuilderInitial<string>, TRequired>
> &
  Record<
    "Currency",
    RequiredColumn<
      PgTextBuilderInitial<string, [string, ...string[]]>,
      TRequired
    >
  >;

const currencies = new Set(Intl.supportedValuesOf("currency"));

/** An ISO 4217 currency code that this Node build knows. */
export const currencyCode = z
  .string()
  .regex(/^[A-Z]{3}$/u, "Use a three-letter ISO 4217 code, such as GBP")
  .refine((code) => currencies.has(code), "Unknown currency");

const amount = z.int();

const moneyValue = z.strictObject({ amount, currency: currencyCode });

const digitsByCurrency = new Map<string, number>();

/** How many minor-unit digits a currency has: 2 for GBP, 0 for JPY. */
export const minorDigits = (currency: string): number => {
  let digits = digitsByCurrency.get(currency);
  if (digits === undefined) {
    digits =
      new Intl.NumberFormat("en", {
        style: "currency",
        currency,
      }).resolvedOptions().maximumFractionDigits ?? 2;
    digitsByCurrency.set(currency, digits);
  }
  return digits;
};

/** `GBP 1234.50`: the code, then the amount with no grouping. */
export const formatMoney = ({ amount: minor, currency }: Money): string => {
  const digits = minorDigits(currency);
  const sign = minor < 0 ? "-" : "";
  const abs = Math.abs(minor);
  const scale = 10 ** digits;
  const whole = Math.floor(abs / scale);
  const fraction =
    digits > 0 ? `.${String(abs % scale).padStart(digits, "0")}` : "";
  return `${currency} ${sign}${whole}${fraction}`;
};

type Compare = (column: PgColumn, value: number) => SQL;

/** Compares amounts in the same currency; other currencies never match. */
const compare = (
  op: Compare
): FilterOperator<MoneyColumns<boolean>, typeof moneyValue> => ({
  value: moneyValue,
  where: (columns: BuiltColumns<MoneyColumns<boolean>>, value) =>
    and(
      eq(columns.Currency, value.currency),
      op(columns[""], value.amount)
    ) as SQL,
});

const moneyFilters = {
  eq: compare(eq),
  /** Different amount or different currency. */
  ne: {
    value: moneyValue,
    where: (columns, value) =>
      or(
        ne(columns.Currency, value.currency),
        ne(columns[""], value.amount)
      ) as SQL,
  } satisfies FilterOperator<MoneyColumns<boolean>, typeof moneyValue>,
  gt: compare(gt),
  gte: compare(gte),
  lt: compare(lt),
  lte: compare(lte),
  currency: {
    value: currencyCode,
    where: (columns, value) => eq(columns.Currency, value),
  } satisfies FilterOperator<MoneyColumns<boolean>, typeof currencyCode>,
  isNull: isNullOperator(),
};

export type MoneyField<TRequired extends boolean = boolean> = Field<
  "money",
  Money,
  TRequired,
  MoneyColumns<TRequired>,
  typeof moneyFilters
> & {
  /** The one currency allowed, if the field has one. */
  readonly currency: string | undefined;
};

/**
 * An amount of money: a `bigint` of minor units in `<field>` and an ISO 4217
 * code in `<field>_currency`. Amounts are whole numbers, so there is no
 * rounding; see decision 0014.
 */
export const money = <TRequired extends boolean = false>(
  options?: MoneyOptions<TRequired>
): MoneyField<NoInfer<TRequired>> => {
  const base = baseOptions(options);
  const only = options?.currency;
  if (only !== undefined && !currencyCode.safeParse(only).success) {
    throw new Error(`money: "${only}" isn't an ISO 4217 currency code`);
  }
  const value =
    only === undefined
      ? moneyValue
      : z.strictObject({ amount, currency: z.literal(only) });
  return {
    kind: "money",
    ...base,
    currency: only,
    columns: (name) => ({
      "": requiredColumn(bigint(name, { mode: "number" }), base.required),
      Currency: requiredColumn(text(`${name}_currency`), base.required),
    }),
    toColumns: (v) => ({
      "": v?.amount ?? null,
      Currency: v?.currency ?? null,
    }),
    fromColumns: (row) => {
      if (row[""] === null || row[""] === undefined) {
        // Only a field that isn't required has empty columns.
        return null as never;
      }
      return { amount: Number(row[""]), currency: String(row.Currency) };
    },
    input: orNull(value, base.required),
    output: orNull(
      z.object({ amount: z.number(), currency: z.string() }),
      base.required
    ),
    display: (v) => (v === null ? "" : formatMoney(v)),
    filters: moneyFilters,
  };
};
