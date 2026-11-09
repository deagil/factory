// Checks that keep the architecture rules in AGENTS.md from depending on
// review. Oxlint cannot allow `import type` while refusing a value import
// from the same package, so the web rule lives here with the others.
//
// Ranks follow the packages as they depend on each other now: events starts
// workflow runs, so it sits above workflows, and workflows reads config.

import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";

/** Lower ranks sit further down. A package may depend only on a lower rank. */
export const dependencyRank: Readonly<Record<string, number>> = {
  "@workspace/db": 0,
  "@workspace/ui": 0,
  "@workspace/objects": 1,
  "@workspace/actions": 2,
  "@workspace/auth": 3,
  "@workspace/config": 3,
  "@workspace/workflows": 4,
  "@workspace/events": 5,
  "@workspace/sdk": 6,
  "@workspace/server": 6,
  web: 7,
  "@workspace/example-crm": 7,
  "@workspace/comms": 7,
  "@workspace/documents": 7,
  "@workspace/payments": 7,
  "@workspace/reports": 7,
};

/** What a dependency that points the wrong way should say. */
export const dependencyOrder =
  "The order is server and apps/web, then events, then workflows, then config and auth, then actions, objects, db.";

export interface WorkspacePackage {
  readonly name: string;
  /** Path from the repo root, with forward slashes. */
  readonly directory: string;
  readonly dependencies: readonly string[];
}

const testingPackage = "@workspace/testing";

const rankProblem = (
  pkg: WorkspacePackage,
  dependency: string,
  packages: ReadonlyMap<string, WorkspacePackage>
): string | null => {
  if (dependency === testingPackage) {
    return null;
  }
  const target = packages.get(dependency);
  if (
    pkg.directory.startsWith("packages/") &&
    target?.directory.startsWith("modules/")
  ) {
    return `${pkg.name} depends on ${dependency}. Packages must not depend on modules.`;
  }
  if (pkg.name === testingPackage && dependency.startsWith("@workspace/")) {
    return `${testingPackage} must not depend on other workspace packages.`;
  }
  const from = dependencyRank[pkg.name];
  const to = dependencyRank[dependency];
  if (from === undefined || to === undefined) {
    return to === undefined
      ? null
      : `${pkg.name} is outside the dependency order and depends on ${dependency}.`;
  }
  if (from <= to) {
    return `${pkg.name} depends on ${dependency}, which is not below it. ${dependencyOrder}`;
  }
  return null;
};

/** Dependencies that point the wrong way, including auth's real ones. */
export const dependencyProblems = (
  packages: readonly WorkspacePackage[]
): string[] => {
  const byName = new Map(packages.map((pkg) => [pkg.name, pkg]));
  return packages.flatMap((pkg) =>
    pkg.dependencies.flatMap((dependency) => {
      const problem = rankProblem(pkg, dependency, byName);
      return problem ? [problem] : [];
    })
  );
};

const skipped = new Set(["node_modules", "dist", ".turbo", ".git"]);

/** TypeScript source under `dir`, including tests. */
export const sourceFiles = (dir: string): string[] =>
  readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      return skipped.has(entry.name) ? [] : sourceFiles(full);
    }
    return entry.isFile() && /\.(?:ts|tsx)$/u.test(entry.name) ? [full] : [];
  });

const readJson = (
  file: string
): {
  name?: string;
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
} =>
  JSON.parse(readFileSync(file, "utf-8")) as {
    name?: string;
    dependencies?: Record<string, string>;
    devDependencies?: Record<string, string>;
  };

/** Workspace packages under `root`, with their workspace dependencies. */
export const readWorkspacePackages = (root: string): WorkspacePackage[] => {
  const roots = ["packages", "apps", "modules", "examples", "tools"];
  return roots.flatMap((top) => {
    const dir = path.join(root, top);
    return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
      if (!entry.isDirectory()) {
        return [];
      }
      const file = path.join(dir, entry.name, "package.json");
      if (!existsSync(file)) {
        return [];
      }
      const json = readJson(file);
      const names = [
        ...Object.keys(json.dependencies ?? {}),
        ...Object.keys(json.devDependencies ?? {}),
      ].filter((name) => name.startsWith("@workspace/") || name === "web");
      return [
        {
          name: json.name ?? entry.name,
          directory: `${top}/${entry.name}`,
          dependencies: names,
        },
      ];
    });
  });
};

const comments = /\/\*[\s\S]*?\*\/|\/\/[^\n]*/gu;
const planId = /\bP\d+[a-z]?(?:\.\d+[a-z]?)+\b/u;
const bannedWords = /\b(?:TODO|HACK|workarounds?)\b/iu;
const tsDirective = /@(?:ts-ignore|ts-expect-error)\b/u;

const lineAt = (source: string, offset: number) =>
  source.slice(0, offset).split("\n").length;

export interface SourceProblem {
  readonly line: number;
  readonly message: string;
}

/** Plan ids, unfinished-work markers and TypeScript error suppressions in comments. */
export const commentProblems = (source: string): SourceProblem[] =>
  [...source.matchAll(comments)].flatMap((match) => {
    const [text = ""] = match;
    const line = lineAt(source, match.index);
    const problems: SourceProblem[] = [];
    if (planId.test(text)) {
      problems.push({
        line,
        message: "Plan ids belong in docs/plans, not in source comments.",
      });
    }
    if (bannedWords.test(text)) {
      problems.push({
        line,
        message: "TODO, HACK and workaround comments are not allowed.",
      });
    }
    if (tsDirective.test(text)) {
      problems.push({
        line,
        message: "Use a type that checks, not @ts-ignore or @ts-expect-error.",
      });
    }
    return problems;
  });

const relativePath = (root: string, file: string) =>
  path.relative(root, file).split(path.sep).join("/");

/**
 * Files under `root` with a banned comment that are not on `allowlist`, and
 * allowlist entries that no longer have one. The allowlist is the current
 * tree; a new file has to stay clean.
 */
export const commentFileProblems = (
  root: string,
  files: readonly string[],
  allowlist: readonly string[]
): string[] => {
  const allowed = new Set(allowlist);
  const found = new Set<string>();
  const problems: string[] = [];
  for (const file of files) {
    const relative = relativePath(root, file);
    const hits = commentProblems(readFileSync(file, "utf-8"));
    const [first] = hits;
    if (!first) {
      continue;
    }
    found.add(relative);
    if (!allowed.has(relative)) {
      problems.push(`${relative}:${first.line} ${first.message}`);
    }
  }
  for (const file of allowlist) {
    if (!found.has(file)) {
      problems.push(
        `${file} is on the comment allowlist and no longer has a banned comment.`
      );
    }
  }
  return problems;
};

const cast = /as\s+unknown\s+as/u;

/**
 * Files under `root` that use `as unknown as` and are not on `allowlist`,
 * and allowlist entries that no longer have one.
 */
export const castProblems = (
  root: string,
  files: readonly string[],
  allowlist: readonly string[]
): string[] => {
  const allowed = new Set(allowlist);
  const found = new Set<string>();
  const problems: string[] = [];
  for (const file of files) {
    const relative = relativePath(root, file);
    const code = readFileSync(file, "utf-8").replaceAll(comments, (comment) =>
      comment.replaceAll(/[^\n]/gu, " ")
    );
    if (!cast.test(code)) {
      continue;
    }
    found.add(relative);
    if (!allowed.has(relative)) {
      problems.push(
        `${relative} uses a double cast. Narrow the type, or add the file to the allowlist with a reason.`
      );
    }
  }
  for (const file of allowlist) {
    if (!found.has(file)) {
      problems.push(
        `${file} is on the cast allowlist and no longer needs to be.`
      );
    }
  }
  return problems;
};

/** Packages the web app may read as types, and never as values. */
export const webTypeOnlyPackages = [
  "@workspace/server",
  "@workspace/actions",
  "@workspace/db",
  "@workspace/objects",
  "@workspace/config",
] as const;

const forbiddenWeb = ["drizzle-orm", "pg"] as const;

const isNamed = (specifier: string, name: string) =>
  specifier === name || specifier.startsWith(`${name}/`);

const importStatement =
  /(?:^|\n)\s*(?<kind>import|export)(?<typeOnly>\s+type)?\s(?:(?!\b(?:import|export)\b)[\s\S])*?\bfrom\s*["'](?<specifier>[^"']+)["']/gu;

const dynamicImport = /\bimport\s*\(\s*["'](?<specifier>[^"']+)["']\s*\)/gu;

/** Value imports the web app must not have, and any drizzle-orm or pg import. */
export const webImportProblems = (source: string): SourceProblem[] => {
  const code = source.replaceAll(comments, (comment) =>
    comment.replaceAll(/[^\n]/gu, " ")
  );
  const problems: SourceProblem[] = [];
  for (const match of code.matchAll(importStatement)) {
    const specifier = match.groups?.specifier ?? "";
    const line = lineAt(code, match.index);
    if (forbiddenWeb.some((name) => isNamed(specifier, name))) {
      problems.push({
        line,
        message: `imports ${specifier}. The web app does not talk to the database.`,
      });
    } else if (
      match.groups?.typeOnly === undefined &&
      webTypeOnlyPackages.some((name) => isNamed(specifier, name))
    ) {
      problems.push({
        line,
        message: `imports ${specifier} as a value. The web app may only import type from it.`,
      });
    }
  }
  for (const match of code.matchAll(dynamicImport)) {
    const specifier = match.groups?.specifier ?? "";
    const banned =
      forbiddenWeb.some((name) => isNamed(specifier, name)) ||
      webTypeOnlyPackages.some((name) => isNamed(specifier, name));
    if (banned) {
      problems.push({
        line: lineAt(code, match.index),
        message: `imports ${specifier}. The web app may only import type from the core, and never the database driver.`,
      });
    }
  }
  return problems;
};
