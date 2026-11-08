// validateConfig (P2.04, SYSTEM_DESIGN §4.4): every file against its type's
// schema, then every reference against what the running system has. Each
// problem names the file, the path in it, the line and what's wrong.
import type {
  AnyConfigType,
  ConfigPath,
  Reference,
  ReferenceKind,
} from "./config-type.ts";
import { readConfig } from "./read.ts";
import type { ConfigFile, ConfigProblem, ConfigRead } from "./read.ts";

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
    ],
  };
};
