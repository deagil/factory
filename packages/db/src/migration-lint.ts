// Migration lint: migrations expand, then contract (SYSTEM_DESIGN section 6,
// AGENTS.md rule 10). A migration must work with the code already running, so
// destructive statements are refused unless the file is marked as the
// contract step on its first line:
//
// -- contract-step: drop deals.legacy_stage, unused since the stage rename

/** The first-line marker that allows destructive statements in a migration. */
export const contractMarker = /^--[ \t]*contract-step:[ \t]*\S/u;

export interface MigrationFinding {
  /** 1-based statement number within the file. */
  readonly statement: number;
  readonly rule: string;
  readonly message: string;
  readonly sql: string;
}

interface Rule {
  readonly name: string;
  readonly test: (sql: string) => boolean;
  readonly message: string;
}

const rules: readonly Rule[] = [
  {
    name: "drop",
    // DROP NOT NULL only loosens a column, which running code accepts.
    test: (sql) => /\bdrop\b(?!\s+not\s+null)/u.test(sql),
    message:
      "DROP removes something running code may still use. Stop using it first, then drop it in a contract step.",
  },
  {
    name: "rename",
    test: (sql) => /\brename\b/u.test(sql),
    message:
      "RENAME breaks running code that uses the old name. Add the new column or table, copy the data, then drop the old one in a contract step.",
  },
  {
    name: "alter-type",
    test: (sql) =>
      /\balter\s+column\s+\S+\s+(?:set\s+data\s+)?type\b/u.test(sql),
    message:
      "Changing a column's type can break running code and rewrite the table. Add a new column instead, then drop the old one in a contract step.",
  },
  {
    name: "set-not-null",
    test: (sql) => /\balter\s+column\s+\S+\s+set\s+not\s+null\b/u.test(sql),
    message:
      "SET NOT NULL fails on existing nulls and breaks running code that writes them. Backfill first, then set it in a contract step.",
  },
  {
    name: "add-required-column",
    test: (sql) =>
      /\badd\s+column\b/u.test(sql) &&
      /\bnot\s+null\b/u.test(sql) &&
      !/\bdefault\b/u.test(sql),
    message:
      "A new NOT NULL column without a default breaks inserts from running code. Give it a default, or add it nullable and tighten it in a contract step.",
  },
  {
    name: "truncate",
    test: (sql) => /\btruncate\b/u.test(sql),
    message: "TRUNCATE deletes data. Do it in a contract step, if at all.",
  },
];

/** Lowercases a statement and blanks out comments and quoted text. */
const normalise = (sql: string): string =>
  sql
    .replaceAll(/--[^\n]*/gu, " ")
    .replaceAll(/\/\*[\s\S]*?\*\//gu, " ")
    .replaceAll(/'(?:[^']|'')*'/gu, "''")
    .replaceAll(/"(?:[^"]|"")*"/gu, '"x"')
    .toLowerCase();

/** Splits a Drizzle migration into its statements. */
export const splitStatements = (sql: string): string[] =>
  sql
    .split("--> statement-breakpoint")
    .flatMap((chunk) => chunk.split(/;\s*(?:\n|$)/u))
    .map((statement) => statement.trim())
    .filter((statement) => normalise(statement).trim() !== "");

/** Whether a migration is marked as a contract step. */
export const isContractStep = (sql: string): boolean =>
  contractMarker.test(sql.trimStart());

/**
 * Lints one migration file. Returns no findings for a marked contract step;
 * otherwise one finding per destructive statement and rule.
 */
export const lintMigration = (sql: string): MigrationFinding[] => {
  if (isContractStep(sql)) {
    return [];
  }
  return splitStatements(sql).flatMap((statement, index) => {
    const normalised = normalise(statement);
    return rules
      .filter((rule) => rule.test(normalised))
      .map((rule) => ({
        statement: index + 1,
        rule: rule.name,
        message: rule.message,
        sql: statement,
      }));
  });
};
