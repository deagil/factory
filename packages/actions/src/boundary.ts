// Handlers reach services only through `ctx` (AGENTS.md rule 7). A file that
// defines actions or queries may not import the database, config, auth or
// server packages, build a repository or data access layer itself, or read
// the system clock. This check finds files that do; the core runs it on its
// own source in tests, and systems run it in CI. See decision 0019.

import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";

/** Packages that hold services. Subpaths are included. */
export const serviceModules = [
  "@workspace/db",
  "@workspace/config",
  "@workspace/auth",
  "@workspace/server",
  "drizzle-orm",
  "pg",
] as const;

/** Functions that build services or open transactions. */
export const serviceFactories = [
  "createRepository",
  "createDataAccess",
  "createDb",
  "withTransaction",
] as const;

export interface BoundaryProblem {
  /** 1-based. */
  line: number;
  message: string;
}

export interface FileProblems {
  file: string;
  problems: BoundaryProblem[];
}

const comments = /\/\*[\s\S]*?\*\/|\/\/[^\n]*/gu;
const definesHandlers = /\bdefine(?:Action|Query)\s*[<(]/u;
const specifiers =
  /(?:\bfrom|\bimport|\bimport\s*\(|\brequire\s*\()\s*["'](?<specifier>[^"']+)["']/gu;
const factories = new RegExp(
  `\\b(?<name>${serviceFactories.join("|")})\\b`,
  "gu"
);
const systemClock = /\bDate\.now\s*\(|\bnew\s+Date\s*\(\s*\)/gu;

/** `source` with comments blanked out, keeping every offset and line. */
const withoutComments = (source: string) =>
  source.replaceAll(comments, (comment) => comment.replaceAll(/[^\n]/gu, " "));

const lineAt = (source: string, offset: number) =>
  source.slice(0, offset).split("\n").length;

const isServiceModule = (specifier: string) =>
  serviceModules.some(
    (name) => specifier === name || specifier.startsWith(`${name}/`)
  );

/**
 * Problems in one file's source. A file that defines no action or query has
 * none: only handler files are held to the boundary.
 */
export const checkSource = (source: string): BoundaryProblem[] => {
  const code = withoutComments(source);
  if (!definesHandlers.test(code)) {
    return [];
  }
  const problems: BoundaryProblem[] = [];
  for (const match of code.matchAll(specifiers)) {
    const specifier = match.groups?.specifier ?? "";
    if (isServiceModule(specifier)) {
      problems.push({
        line: lineAt(code, match.index),
        message: `imports ${specifier}. Handlers reach the database, config and other services through ctx.`,
      });
    }
  }
  for (const match of code.matchAll(factories)) {
    problems.push({
      line: lineAt(code, match.index),
      message: `uses ${match.groups?.name}. Use ctx.repo and ctx.dal, which are bound to the action's transaction.`,
    });
  }
  for (const match of code.matchAll(systemClock)) {
    problems.push({
      line: lineAt(code, match.index),
      message: "reads the system clock. Use ctx.clock.now().",
    });
  }
  return problems.toSorted((a, b) => a.line - b.line);
};

const skipped = new Set(["node_modules", "dist", ".turbo", ".git"]);
const isSourceFile = (name: string) =>
  /\.(?:ts|tsx|mts)$/u.test(name) &&
  !/\.(?:test|spec)\.(?:ts|tsx|mts)$/u.test(name) &&
  !name.endsWith(".d.ts");

/** Source files under `dir`, skipping tests, dependencies and build output. */
const sourceFiles = (dir: string): string[] =>
  readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      return skipped.has(entry.name) ? [] : sourceFiles(full);
    }
    return entry.isFile() && isSourceFile(entry.name) ? [full] : [];
  });

/**
 * Checks every source file under `dirs`. Test files are skipped: tests set
 * up databases around the handlers they define.
 */
export const checkHandlerBoundary = (dirs: readonly string[]): FileProblems[] =>
  dirs
    .flatMap((dir) => sourceFiles(dir))
    .map((file) => ({
      file,
      problems: checkSource(readFileSync(file, "utf-8")),
    }))
    .filter(({ problems }) => problems.length > 0);

/** A report of `found`, one line per problem, for a failing check. */
export const formatBoundaryProblems = (
  found: readonly FileProblems[],
  root = process.cwd()
): string =>
  found
    .flatMap(({ file, problems }) =>
      problems.map(
        ({ line, message }) => `${path.relative(root, file)}:${line} ${message}`
      )
    )
    .join("\n");
