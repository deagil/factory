# 0014. How field types store and filter values

- **Status:** Accepted
- **Date:** 2026-11-06

## Context

Section 4.1 of the system design says each field type gives its column, Zod rule, display and filters, and section 3 says money is "integer minor units with a currency". It doesn't say how a field with two values gets its columns, what a date or money value looks like in JSON, or what filters look like. `defineObject` (P1.02), the data access layer (P1.04) and the generated `.list` query (P1.09) all build on the answers.

## Decision

- **A field can own several columns.** It describes them as a map from a suffix to a Drizzle column builder; the main column's suffix is `""`. defineObject turns the field `value` with suffixes `""` and `Currency` into the table properties `value` and `valueCurrency`. Single-column fields have only `""`.
- **Money is two columns:** a `bigint` of minor units in `<field>` and an ISO 4217 code in `<field>_currency`. Its value is `{ amount, currency }`, with `amount` a whole number of minor units (1234 GBP is £12.34). There's no rounding anywhere. `f.money({ currency: "GBP" })` allows only one currency. Filters compare amounts only within the same currency.
- **Refs are a `uuid` column named `<field>_id`.** The value is the referenced record's id. defineObject adds the foreign key, because only it knows the target's table.
- **Dates are calendar dates**, `date` columns read and written as `YYYY-MM-DD` strings. They have no time zone to get wrong, and they compare correctly as strings.
- **Numbers** are `double precision`, or `integer` with `integer: true`. Money is for amounts of money.
- **Required means NOT NULL.** A field that isn't required takes and returns `null`.
- **Input and output are different schemas.** The input schema holds the rules (trimming, length, range, currency, real dates). The output schema only checks the shape, so a record saved before a rule was tightened still reads.
- **Display is plain and locale-free:** `GBP 1234.50`, `Yes`, `2026-11-06`, and `""` for null. It's for lists, logs and agents; the web app formats for people itself.
- **A filter on a field is an object of operators that must all hold**, such as `{ gte: 10, lt: 20 }`. The operators are `eq`, `ne`, `in` (at most 100 values), `gt`, `gte`, `lt`, `lte`, `contains` and `startsWith` (text, ignoring case), `currency` (money) and `isNull` (`true` for empty, `false` for filled). Each type lists the ones it supports, each with a Zod schema for its value. `filterSchema(field)` rejects unknown operators.

## Consequences

- A filter or sort on money has to go through the field, not a single column; the data access layer gets both columns from the field.
- Amounts beyond 2^53 minor units are refused. That's about 90 trillion pounds.
- A time-of-day or timestamp field is a separate type, added when an object needs one.
- `contains` is an `ILIKE`, which can't use a plain index. Search over large tables needs its own index when the need is real.
