import type { z } from "zod";

import { plainChoiceOption } from "./choices.ts";
import type { ChoiceList } from "./choices.ts";
// validateConfig (P2.04, SYSTEM_DESIGN §4.4): every file against its type's
// schema, then every reference against what the running system has. Each
// problem names the file, the path in it, the line and what's wrong.
import type {
  AnyConfigType,
  ConfigPath,
  Reference,
  ReferenceKind,
} from "./config-type.ts";
import { configExtension, readConfig } from "./read.ts";
import type { ConfigFile, ConfigProblem, ConfigRead } from "./read.ts";

/** A choice list defined in code (decision 0040). */
export interface ChoiceListUse {
  readonly key: string;
  /** Keys code acts on: the list must have exactly these, none archived. */
  readonly keys?: readonly string[] | undefined;
  /** One option: the built-in columns and the list's own. */
  readonly option: z.ZodObject;
  /** The fields that use it, as `object.field`. */
  readonly usedBy: readonly string[];
}

/** What the running system has, for checking references. */
export interface ConfigCatalog {
  /** Each object's name, with its field names. */
  readonly objects: ReadonlyMap<string, readonly string[]>;
  /** Actions and queries a role grants by name: the hand-written ones. */
  readonly actions: ReadonlySet<string>;
  /** Object endpoints, by name, which roles grant under the object. */
  readonly objectActions: ReadonlyMap<
    string,
    { readonly object: string; readonly job: string }
  >;
  /** The objects with an owner field, which `rows: own` needs. */
  readonly owners: ReadonlySet<string>;
  /** Every event an action emits. */
  readonly events: ReadonlySet<string>;
  /** Every choice list code defines, for checking its file (P2.06). */
  readonly choiceLists: readonly ChoiceListUse[];
}

/** The config type whose file keys a reference of this kind names. */
const configKinds: Partial<Record<ReferenceKind, string>> = {
  role: "roles",
  template: "templates",
};

const listed = (names: Iterable<string>) => {
  const all = [...names].toSorted();
  return all.length > 0 ? all.join(", ") : "none";
};

/** Why the choice "list.option" doesn't resolve, or null when it does. */
const unresolvedChoice = (
  name: string,
  files: readonly ConfigFile[]
): string | null => {
  const [list = "", option = ""] = name.split(".");
  const options = (
    files.find((file) => file.type === "choices" && file.key === list)
      ?.value as ChoiceList | undefined
  )?.options;
  if (!options) {
    return `There is no choice list "${list}" in config/choices.`;
  }
  const found = options.find((each) => each.key === option);
  if (!found) {
    return `${list} has no option "${option}". Options: ${listed(options.map((each) => each.key))}.`;
  }
  return found.archived
    ? `${list}'s option "${option}" is archived, but this still uses it. Change this first, or keep the option.`
    : null;
};

/** Why an action or config type a file names doesn't resolve, or null. */
const unresolvedTarget = (
  kind: "action" | "anyAction" | "configType",
  name: string,
  catalog: ConfigCatalog,
  types: readonly string[]
): string | null => {
  if (kind === "configType") {
    return types.includes(name)
      ? null
      : `There is no config type "${name}". Types: ${listed(types)}.`;
  }
  if (catalog.actions.has(name)) {
    return null;
  }
  const generated = catalog.objectActions.get(name);
  if (kind === "anyAction") {
    return generated ? null : `There is no action "${name}".`;
  }
  return generated
    ? `${name} is ${generated.object}'s ${generated.job} endpoint, so grant it under objects: ${generated.object}: endpoints: [${generated.job}].`
    : `There is no workflow, action or query "${name}".`;
};

/** Why a reference to an object, or a part of one, doesn't resolve. */
const unresolvedObjectPart = (
  kind: "object" | "field" | "endpoint" | "owner",
  name: string,
  catalog: ConfigCatalog
): string | null => {
  switch (kind) {
    case "object": {
      return catalog.objects.has(name)
        ? null
        : `There is no object "${name}". Objects: ${listed(catalog.objects.keys())}.`;
    }
    case "field": {
      const [object = "", field = ""] = name.split(".");
      const fields = catalog.objects.get(object);
      if (!fields) {
        return `There is no object "${object}". Objects: ${listed(catalog.objects.keys())}.`;
      }
      return fields.includes(field)
        ? null
        : `${object} has no field "${field}". Fields: ${listed(fields)}.`;
    }
    case "endpoint": {
      const object = name.slice(0, name.lastIndexOf("_"));
      const job = name.slice(name.lastIndexOf("_") + 1);
      // An object that isn't there is reported once, by its own reference.
      return catalog.objectActions.has(name) || !catalog.objects.has(object)
        ? null
        : `${object} has no ${job} endpoint: an action of its own does that job, so grant that under workflows.`;
    }
    case "owner": {
      return catalog.owners.has(name) || !catalog.objects.has(name)
        ? null
        : `${name} has no owner field, so rows: own can't apply. Give it one in defineObject (owner: "owner"), or use rows: all.`;
    }
    default: {
      return null;
    }
  }
};

/** Why `reference` doesn't resolve, or null when it does. */
const unresolved = (
  reference: Reference,
  catalog: ConfigCatalog,
  files: readonly ConfigFile[],
  types: readonly string[]
): string | null => {
  const { kind, name } = reference;
  switch (kind) {
    case "object":
    case "field": {
      return unresolvedObjectPart(kind, name, catalog);
    }
    case "action":
    case "anyAction":
    case "configType": {
      return unresolvedTarget(kind, name, catalog, types);
    }
    case "endpoint":
    case "owner": {
      return unresolvedObjectPart(kind, name, catalog);
    }
    case "event": {
      return catalog.events.has(name)
        ? null
        : `No action emits the event "${name}".`;
    }
    case "choice": {
      return unresolvedChoice(name, files);
    }
    case "role":
    case "template": {
      const type = configKinds[kind] ?? kind;
      const keys = files
        .filter((file) => file.type === type)
        .map((file) => file.key);
      return keys.includes(name)
        ? null
        : `There is no ${kind} "${name}" in config/${type}. ${kind === "role" ? "Roles" : "Templates"}: ${listed(keys)}.`;
    }
    default: {
      return `Config can't refer to a ${kind} yet.`;
    }
  }
};

interface ListProblem {
  path: ConfigPath;
  message: string;
}

/** Each row against the list's columns, built-in and its own. */
const rowProblems = (
  list: ChoiceList,
  option: z.ZodType,
  columns: readonly string[]
): ListProblem[] =>
  list.options.flatMap((row, index) => {
    const parsed = option.safeParse(row);
    if (parsed.success) {
      return [];
    }
    return parsed.error.issues.flatMap((issue): ListProblem[] => {
      const at: ConfigPath = ["options", index, ...(issue.path as ConfigPath)];
      if (issue.code === "unrecognized_keys") {
        return issue.keys.map((name) => ({
          path: [...at, name],
          message: `"${name}" isn't a column of ${list.key}. Columns: ${listed(columns)}. New columns are defined in code.`,
        }));
      }
      return [{ path: at, message: issue.message }];
    });
  });

/** A list with fixed keys has exactly those, none archived. */
const fixedKeyProblems = (
  list: ChoiceList,
  keys: readonly string[]
): ListProblem[] => [
  ...keys
    .filter((key) => !list.options.some((option) => option.key === key))
    .map((key) => ({
      path: ["options"],
      message: `${list.key} needs the option "${key}": code acts on it.`,
    })),
  ...list.options.flatMap((option, index) => [
    ...(keys.includes(option.key)
      ? []
      : [
          {
            path: ["options", index, "key"],
            message: `Code acts on each key of ${list.key} (${listed(keys)}), so "${option.key}" can't be added here. New keys ship with the code that handles them.`,
          },
        ]),
    ...(option.archived
      ? [
          {
            path: ["options", index, "archived"],
            message: `Code acts on each key of ${list.key}, so "${option.key}" can't be archived.`,
          },
        ]
      : []),
  ]),
];

/**
 * Each choice list file against its definition in code: every row's columns,
 * and the keys code acts on. A list code uses must have a file; a file no
 * code defines may have the built-in columns only.
 */
export const checkChoiceLists = (
  files: readonly ConfigFile[],
  catalog: ConfigCatalog
): ConfigProblem[] => {
  const missing = catalog.choiceLists.flatMap((use): ConfigProblem[] =>
    files.some((file) => file.type === "choices" && file.key === use.key)
      ? []
      : [
          {
            file: `config/choices/${use.key}${configExtension}`,
            path: [],
            line: null,
            message: `${listed(use.usedBy)} ${use.usedBy.length === 1 ? "uses" : "use"} this list, but the file doesn't exist.`,
          },
        ]
  );
  const rows = files
    .filter((file) => file.type === "choices")
    .flatMap((file): ConfigProblem[] => {
      const list = file.value as ChoiceList;
      const use = catalog.choiceLists.find((each) => each.key === list.key);
      const option = use?.option ?? plainChoiceOption;
      return [
        ...rowProblems(list, option, Object.keys(option.shape)),
        ...(use?.keys ? fixedKeyProblems(list, use.keys) : []),
      ].map((problem) => ({
        file: file.file,
        path: problem.path,
        line: file.lineOf(problem.path),
        message: problem.message,
      }));
    });
  return [...missing, ...rows];
};

/** The problems with each file's references. */
export const checkReferences = (
  files: readonly ConfigFile[],
  types: readonly AnyConfigType[],
  catalog: ConfigCatalog
): ConfigProblem[] => {
  const byType = new Map(types.map((each) => [each.type, each]));
  const typeNames = [...byType.keys()];
  return files.flatMap((file) => {
    const references = byType.get(file.type)?.references(file.value) ?? [];
    return references.flatMap((reference): ConfigProblem[] => {
      const message = unresolved(reference, catalog, files, typeNames);
      const at: ConfigPath = reference.path;
      return message
        ? [{ file: file.file, path: at, line: file.lineOf(at), message }]
        : [];
    });
  });
};

/**
 * Reads `configDir` and checks it: each file against its type's schema, then
 * its references against `catalog`. Files with problems are still returned.
 */
export const validateConfig = (
  configDir: string,
  types: readonly AnyConfigType[],
  catalog: ConfigCatalog
): ConfigRead => {
  const read = readConfig(configDir, types);
  return {
    files: read.files,
    problems: [
      ...read.problems,
      ...checkReferences(read.files, types, catalog),
      ...checkChoiceLists(read.files, catalog),
    ],
  };
};
