// The schema check: does the database match the tables the code defines?
// It runs at start-up (createServer, P1.18) and in CI (db:check-migrations).
// See docs/SYSTEM_DESIGN.md section 6, Guardrails, and decision 0016.
//
// It compares tables in the `public` schema only. DBOS and Better Auth keep
// their tables in their own schemas, and Drizzle's migration journal is in
// `drizzle`.

import { sql } from "drizzle-orm";
import { getTableConfig } from "drizzle-orm/pg-core";
import type { PgTable } from "drizzle-orm/pg-core";

import type { Executor } from "./client.ts";
import {
  actionLog,
  actorRoles,
  actors,
  apiKeys,
  auditLog,
  configVersions,
  drafts,
  eventLog,
  users,
} from "./schema/core.ts";

/** The core tables, which every database has alongside the object tables. */
export const coreTables: readonly PgTable[] = [
  users,
  actors,
  actorRoles,
  apiKeys,
  actionLog,
  auditLog,
  eventLog,
  configVersions,
  drafts,
];

/** One way the database differs from the code. */
export type SchemaProblem =
  | { kind: "missing_table"; table: string; message: string }
  | { kind: "missing_column"; table: string; column: string; message: string }
  | {
      kind: "wrong_type";
      table: string;
      column: string;
      expected: string;
      actual: string;
      message: string;
    }
  | {
      kind: "wrong_nullability";
      table: string;
      column: string;
      expected: "null" | "not null";
      message: string;
    }
  | { kind: "stray_table"; table: string; message: string };

export interface SchemaCheckResult {
  readonly ok: boolean;
  readonly problems: readonly SchemaProblem[];
  /**
   * Columns the database has and the code doesn't use. They're allowed:
   * code stops using a column before a contract step drops it.
   */
  readonly unusedColumns: readonly { table: string; column: string }[];
}

const behind =
  "The database is behind the code. Run `pnpm db:migrate`. If this change edits the schema, `pnpm fx dev` pushes it to the change's database and `pnpm fx ship` writes its migration.";

const drift =
  "The database and the code disagree. Run `pnpm db:migrate`; if it's up to date, the schema changed without a migration, and `pnpm fx ship` writes one.";

const stray =
  "Every table comes from defineObject or the core (AGENTS.md rule 3). Define it with defineObject, or drop it in a contract-step migration (decision 0013).";

/**
 * Puts a column type in the form Postgres's `format_type` prints, so
 * Drizzle's names (`varchar(20)`, `timestamp (3) with time zone`) compare
 * with the database's (`character varying(20)`, `timestamp(3) with time zone`).
 */
export const normaliseType = (type: string): string => {
  let t = type.toLowerCase().replaceAll(/\s+/gu, " ").trim();
  t = t.replaceAll(/\s*\(\s*/gu, "(").replaceAll(/\s*,\s*/gu, ",");
  const aliases: [RegExp, string][] = [
    [/^varchar\b/u, "character varying"],
    [/^char\b/u, "character"],
    [/^decimal\b/u, "numeric"],
    [/^int4?$/u, "integer"],
    [/^int8$/u, "bigint"],
    [/^int2$/u, "smallint"],
    [/^serial$/u, "integer"],
    [/^bigserial$/u, "bigint"],
    [/^smallserial$/u, "smallint"],
    [/^float8$/u, "double precision"],
    [/^float4$/u, "real"],
    [/^bool$/u, "boolean"],
    [/^timestamptz$/u, "timestamp with time zone"],
    [
      /^(?<kind>timestamp|time)(?<precision>\(\d+\))?$/u,
      "$<kind>$<precision> without time zone",
    ],
  ];
  for (const [pattern, replacement] of aliases) {
    t = t.replace(pattern, replacement);
  }
  return t;
};

interface DatabaseColumn {
  table: string;
  column: string | null;
  type: string | null;
  not_null: boolean | null;
}

/** Every table in `public`, with its columns. */
const readDatabase = async (executor: Executor) => {
  const result = await executor.execute<
    DatabaseColumn & Record<string, unknown>
  >(sql`
    select c.relname as table,
           a.attname as column,
           format_type(a.atttypid, a.atttypmod) as type,
           a.attnotnull as not_null
      from pg_class c
      join pg_namespace n on n.oid = c.relnamespace
      left join pg_attribute a
        on a.attrelid = c.oid and a.attnum > 0 and not a.attisdropped
     where n.nspname = 'public' and c.relkind in ('r', 'p')
  `);
  const tables = new Map<
    string,
    Map<string, { type: string; notNull: boolean }>
  >();
  for (const row of result.rows) {
    const columns = tables.get(row.table) ?? new Map();
    if (row.column !== null) {
      columns.set(row.column, {
        type: row.type ?? "",
        notNull: row.not_null ?? false,
      });
    }
    tables.set(row.table, columns);
  }
  return tables;
};

/** What the code defines for one table. */
const expectedColumns = (table: PgTable) => {
  const config = getTableConfig(table);
  const inPrimaryKey = new Set(
    config.primaryKeys.flatMap((key) =>
      key.columns.map((column) => column.name)
    )
  );
  return {
    name: config.name,
    schema: config.schema ?? "public",
    columns: config.columns.map((column) => ({
      name: column.name,
      type: column.getSQLType(),
      // Postgres makes primary key columns NOT NULL whatever the definition says.
      notNull:
        column.notNull || column.primary || inPrimaryKey.has(column.name),
    })),
  };
};

/**
 * Compares the database with `tables`, which should be the core tables and
 * every object's table. Problems fail the check; unused columns don't.
 */
export const checkSchema = async (
  executor: Executor,
  tables: readonly PgTable[]
): Promise<SchemaCheckResult> => {
  const database = await readDatabase(executor);
  const problems: SchemaProblem[] = [];
  const unusedColumns: { table: string; column: string }[] = [];
  const defined = new Set<string>();

  for (const table of tables) {
    const expected = expectedColumns(table);
    if (expected.schema !== "public") {
      continue;
    }
    defined.add(expected.name);
    const actual = database.get(expected.name);
    if (!actual) {
      problems.push({
        kind: "missing_table",
        table: expected.name,
        message: `The table "${expected.name}" is missing. ${behind}`,
      });
      continue;
    }
    for (const column of expected.columns) {
      const found = actual.get(column.name);
      const at = `${expected.name}.${column.name}`;
      if (!found) {
        problems.push({
          kind: "missing_column",
          table: expected.name,
          column: column.name,
          message: `The column ${at} is missing. ${behind}`,
        });
        continue;
      }
      const want = normaliseType(column.type);
      const have = normaliseType(found.type);
      if (want !== have) {
        problems.push({
          kind: "wrong_type",
          table: expected.name,
          column: column.name,
          expected: want,
          actual: have,
          message: `The column ${at} is ${have} in the database, but the code says ${want}. ${drift}`,
        });
      }
      if (column.notNull !== found.notNull) {
        const nullability = column.notNull ? "not null" : "null";
        problems.push({
          kind: "wrong_nullability",
          table: expected.name,
          column: column.name,
          expected: nullability,
          message: `The column ${at} should be ${nullability === "null" ? "nullable" : "NOT NULL"}, and the database says otherwise. ${drift}`,
        });
      }
    }
    const used = new Set(expected.columns.map((column) => column.name));
    for (const column of actual.keys()) {
      if (!used.has(column)) {
        unusedColumns.push({ table: expected.name, column });
      }
    }
  }

  for (const table of database.keys()) {
    if (!defined.has(table)) {
      problems.push({
        kind: "stray_table",
        table,
        message: `The table "${table}" isn't defined in the code. ${stray}`,
      });
    }
  }

  return { ok: problems.length === 0, problems, unusedColumns };
};

/** A failed check as text: one line per problem. */
export const formatSchemaProblems = (
  problems: readonly SchemaProblem[]
): string =>
  [
    `The database doesn't match the code (${problems.length} problem${problems.length === 1 ? "" : "s"}):`,
    ...problems.map((problem) => `- ${problem.message}`),
  ].join("\n");

/** Thrown by `assertSchema`; carries the problems for callers that want them. */
export class SchemaCheckError extends Error {
  readonly problems: readonly SchemaProblem[];

  constructor(problems: readonly SchemaProblem[]) {
    super(formatSchemaProblems(problems));
    this.name = "SchemaCheckError";
    this.problems = problems;
  }
}

/** Runs the check and throws a SchemaCheckError if it fails. For start-up. */
export const assertSchema = async (
  executor: Executor,
  tables: readonly PgTable[]
): Promise<SchemaCheckResult> => {
  const result = await checkSchema(executor, tables);
  if (!result.ok) {
    throw new SchemaCheckError(result.problems);
  }
  return result;
};
