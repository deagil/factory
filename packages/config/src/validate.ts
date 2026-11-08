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

/** A choice field in code, and the list it uses. */
export interface ChoiceFieldUse {
  readonly object: string;
  readonly field: string;
  readonly list: string;
  readonly control: "system" | "mapped" | "custom";
  /** `system`: the keys code acts on. */
  readonly keys?: readonly string[] | undefined;
  /** `mapped`: the categories code acts on. */
  readonly categories?: readonly string[] | undefined;
}

/** What the running system has, for checking references. */
export interface ConfigCatalog {
  /** Each object's name, with its field names. */
  readonly objects: ReadonlyMap<string, readonly string[]>;
  /** Actions and queries a role grants by name: the hand-written ones. */
  readonly actions: ReadonlySet<string>;
  /** Generated actions and queries, which roles grant through their object. */
  readonly objectActions: ReadonlyMap<
    string,
    { readonly object: string; readonly can: string }
  >;
  /** Every event an action emits. */
  readonly events: ReadonlySet<string>;
  /** Every choice field, for checking the lists they use (P2.06). */
  readonly choiceFields: readonly ChoiceFieldUse[];
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

/** Why `reference` doesn't resolve, or null when it does. */
const unresolved = (
  reference: Reference,
  catalog: ConfigCatalog,
  files: readonly ConfigFile[]
): string | null => {
  const { kind, name } = reference;
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
    case "action": {
      if (catalog.actions.has(name)) {
        return null;
      }
      const generated = catalog.objectActions.get(name);
      return generated
        ? `${name} is generated for ${generated.object}, so grant it as an object permission: object: ${generated.object}, can: [${generated.can}].`
        : `There is no action or query "${name}".`;
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

/** What one field's control allows in its list, as problems. */
const controlProblems = (
  use: ChoiceFieldUse,
  list: ChoiceList
): { path: ConfigPath; message: string }[] => {
  const uses = `${use.object}.${use.field}`;
  if (use.control === "system") {
    const keys = use.keys ?? [];
    const missing = keys
      .filter((key) => !list.options.some((option) => option.key === key))
      .map((key) => ({
        path: ["options"],
        message: `${uses} is a system choice, so the list needs the option "${key}": code acts on it.`,
      }));
    const extra = list.options.flatMap((option, index) => [
      ...(keys.includes(option.key)
        ? []
        : [
            {
              path: ["options", index, "key"],
              message: `${uses} is a system choice, and code only acts on ${listed(keys)}, so "${option.key}" can't be added here. New keys ship with the code that handles them.`,
            },
          ]),
      ...(option.archived
        ? [
            {
              path: ["options", index, "archived"],
              message: `${uses} is a system choice, so its options can't be archived: code acts on each one.`,
            },
          ]
        : []),
    ]);
    return [...missing, ...extra];
  }
  if (use.control === "mapped") {
    const categories = use.categories ?? [];
    return list.options.flatMap((option, index) => {
      if (option.category === undefined) {
        return [
          {
            path: ["options", index],
            message: `${uses} acts on categories, so "${option.key}" needs a category: ${listed(categories)}.`,
          },
        ];
      }
      return categories.includes(option.category)
        ? []
        : [
            {
              path: ["options", index, "category"],
              message: `"${option.category}" isn't a category ${uses} acts on. Categories: ${listed(categories)}.`,
            },
          ];
    });
  }
  return [];
};

/** The problems with the lists choice fields use, given each field's control. */
export const checkChoiceLists = (
  files: readonly ConfigFile[],
  catalog: ConfigCatalog
): ConfigProblem[] => {
  const problems = catalog.choiceFields.flatMap((use): ConfigProblem[] => {
    const file = files.find(
      (each) => each.type === "choices" && each.key === use.list
    );
    if (!file) {
      return [
        {
          file: `config/choices/${use.list}${configExtension}`,
          path: [],
          line: null,
          message: `${use.object}.${use.field} uses this list, but the file doesn't exist.`,
        },
      ];
    }
    return controlProblems(use, file.value as ChoiceList).map((problem) => ({
      file: file.file,
      path: problem.path,
      line: file.lineOf(problem.path),
      message: problem.message,
    }));
  });
  const seen = new Set<string>();
  return problems.filter((problem) => {
    const id = `${problem.file}|${problem.path.join(".")}|${problem.message}`;
    const fresh = !seen.has(id);
    seen.add(id);
    return fresh;
  });
};

/** The problems with each file's references. */
export const checkReferences = (
  files: readonly ConfigFile[],
  types: readonly AnyConfigType[],
  catalog: ConfigCatalog
): ConfigProblem[] => {
  const byType = new Map(types.map((each) => [each.type, each]));
  return files.flatMap((file) => {
    const references = byType.get(file.type)?.references(file.value) ?? [];
    return references.flatMap((reference): ConfigProblem[] => {
      const message = unresolved(reference, catalog, files);
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
