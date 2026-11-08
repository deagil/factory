// Reading `config/` (decision 0037): plain YAML 1.2, one file per key at
// `config/<type>/<key>.yaml`. Problems name the file, the path in it, the
// line and what's wrong, in plain English.
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

import { isAlias, LineCounter, parseDocument, visit } from "yaml";
import type { Document } from "yaml";
import type { z } from "zod";

import type {
  AnyConfigType,
  ConfigPath,
  Keyed,
  ConfigType,
} from "./config-type.ts";

export const configExtension = ".yaml";

/** One config file, read and valid against its type's schema. */
export interface ConfigFile<TValue extends Keyed = Keyed> {
  readonly type: string;
  readonly key: string;
  /** Relative to the config folder's parent, such as `config/roles/sales.yaml`. */
  readonly file: string;
  readonly value: TValue;
}

export interface ConfigProblem {
  readonly file: string;
  /** Where in the file; empty for the file as a whole. */
  readonly path: ConfigPath;
  /** 1-based, when the problem is at a known place. */
  readonly line: number | null;
  readonly message: string;
}

export interface ConfigRead {
  readonly files: readonly ConfigFile[];
  readonly problems: readonly ConfigProblem[];
}

/** `config/roles/sales.yaml:4 permissions.1.action: …` */
export const formatProblem = (problem: ConfigProblem): string => {
  const where = problem.line === null ? "" : `:${problem.line}`;
  const at = problem.path.length > 0 ? ` ${problem.path.join(".")}:` : "";
  return `${problem.file}${where}${at} ${problem.message}`;
};

/** The line of the node at `at`, or of its nearest parent that exists. */
const lineOf = (
  doc: Document,
  lines: LineCounter,
  at: ConfigPath
): number | null => {
  for (let { length } = at; length >= 0; length -= 1) {
    const node = doc.getIn(at.slice(0, length), true) as
      | { range?: [number, number, number] }
      | undefined;
    if (node?.range) {
      return lines.linePos(node.range[0]).line;
    }
  }
  return null;
};

type Issue = z.core.$ZodIssue;

/**
 * Zod reports a value that matches no member of a union as one "Invalid
 * input". The member with the fewest issues is almost always the one the
 * author meant, so its issues are what the file gets, under the union's path.
 */
const closestIssues = (issues: readonly Issue[]): Issue[] =>
  issues.flatMap((issue): Issue[] => {
    if (issue.code !== "invalid_union" || issue.errors.length === 0) {
      return [issue];
    }
    const [closest] = issue.errors.toSorted((a, b) => a.length - b.length);
    return closestIssues(closest ?? []).map((inner) => ({
      ...inner,
      path: [...issue.path, ...inner.path],
    }));
  });

/** One file's problems and, if it has none, its value. */
const readFile = (
  configType: AnyConfigType,
  absolute: string,
  file: string
): { value?: Keyed; problems: ConfigProblem[] } => {
  const lines = new LineCounter();
  const doc = parseDocument(readFileSync(absolute, "utf-8"), {
    schema: "core",
    uniqueKeys: true,
    lineCounter: lines,
    prettyErrors: false,
  });
  const syntax = [...doc.errors, ...doc.warnings].map(
    (error): ConfigProblem => ({
      file,
      path: [],
      line: error.linePos?.[0].line ?? null,
      message: error.message.split("\n")[0] ?? error.message,
    })
  );
  if (syntax.length > 0) {
    return { problems: syntax };
  }
  const plain: ConfigProblem[] = [];
  visit(doc, {
    Alias: (_key, node) => {
      plain.push({
        file,
        path: [],
        line: node.range ? lines.linePos(node.range[0]).line : null,
        message: "Anchors and aliases aren't allowed; write the value out.",
      });
    },
    Node: (_key, node) => {
      if (!isAlias(node) && node.tag && !node.tag.startsWith("tag:yaml.org")) {
        plain.push({
          file,
          path: [],
          line: node.range ? lines.linePos(node.range[0]).line : null,
          message: `Tags such as ${node.tag} aren't allowed.`,
        });
      }
    },
  });
  if (plain.length > 0) {
    return { problems: plain };
  }
  const parsed = configType.schema.safeParse(doc.toJS());
  if (!parsed.success) {
    return {
      problems: closestIssues(parsed.error.issues).map((issue) => {
        const at = issue.path.filter(
          (part): part is string | number => typeof part !== "symbol"
        );
        return {
          file,
          path: at,
          line: lineOf(doc, lines, at),
          message: issue.message,
        };
      }),
    };
  }
  const value = parsed.data as Keyed;
  const key = path.basename(absolute, configExtension);
  if (value.key !== key) {
    return {
      problems: [
        {
          file,
          path: ["key"],
          line: lineOf(doc, lines, ["key"]),
          message: `The key is "${value.key}" but the file is named ${key}${configExtension}; they must match.`,
        },
      ],
    };
  }
  return { value, problems: [] };
};

/**
 * Reads every file under `configDir` for the given types. Folders with no
 * type, and files that aren't `.yaml`, are problems too.
 */
export const readConfig = (
  configDir: string,
  types: readonly AnyConfigType[]
): ConfigRead => {
  const files: ConfigFile[] = [];
  const problems: ConfigProblem[] = [];
  const shown = (absolute: string) =>
    path.relative(path.dirname(configDir), absolute);
  if (!existsSync(configDir)) {
    return { files, problems };
  }
  const known = new Map(types.map((each) => [each.type, each]));
  for (const folder of readdirSync(configDir).toSorted()) {
    const folderPath = path.join(configDir, folder);
    if (folder.startsWith(".") || !statSync(folderPath).isDirectory()) {
      continue;
    }
    const configType = known.get(folder);
    if (!configType) {
      problems.push({
        file: shown(folderPath),
        path: [],
        line: null,
        message: `There is no config type "${folder}". Types: ${[...known.keys()].join(", ")}.`,
      });
      continue;
    }
    for (const name of readdirSync(folderPath).toSorted()) {
      const absolute = path.join(folderPath, name);
      const file = shown(absolute);
      if (name.startsWith(".")) {
        continue;
      }
      if (!name.endsWith(configExtension)) {
        problems.push({
          file,
          path: [],
          line: null,
          message: `Config files end in ${configExtension}.`,
        });
        continue;
      }
      const read = readFile(configType, absolute, file);
      problems.push(...read.problems);
      if (read.value) {
        files.push({
          type: folder,
          key: read.value.key,
          file,
          value: read.value,
        });
      }
    }
  }
  return { files, problems };
};

/** Config that failed to read; its message lists every problem. */
export class ConfigError extends Error {
  readonly problems: readonly ConfigProblem[];

  constructor(problems: readonly ConfigProblem[]) {
    super(
      `Config has ${problems.length} problem(s):\n${problems.map((problem) => `  ${formatProblem(problem)}`).join("\n")}`
    );
    this.name = "ConfigError";
    this.problems = problems;
  }
}

/** The values of one type's files. */
export const valuesOf = <TValue extends Keyed>(
  files: readonly ConfigFile[],
  configType: ConfigType<TValue>
): TValue[] =>
  files
    .filter((each) => each.type === configType.type)
    .map((each) => each.value as TValue);

/** Reads `configDir` like `readConfig`, and throws a ConfigError if there are problems. */
export const loadConfig = (
  configDir: string,
  types: readonly AnyConfigType[]
): readonly ConfigFile[] => {
  const { files, problems } = readConfig(configDir, types);
  if (problems.length > 0) {
    throw new ConfigError(problems);
  }
  return files;
};
