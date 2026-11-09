// Config types (SYSTEM_DESIGN §4.4, decision 0037). Each type is a folder
// under `config/`, a Zod schema for its files and a list of what each file
// points to, which validateConfig checks against the running code.
import type { z } from "zod";

import type { ConfigFile } from "./read.ts";
import type { ConfigCatalog } from "./validate.ts";

/** What a config file can point to in the running code or other config. */
export const referenceKinds = [
  "object",
  "field",
  "choice",
  "action",
  // Any action, generated ones included, as an approval rule names it.
  "anyAction",
  // A config type, as an approval rule covering drafts names it.
  "configType",
  "event",
  "template",
  "role",
  // An object endpoint, `<object>_<job>`, as a role grants it (P2.14).
  "endpoint",
  // An object with an owner field, as a role's `rows: own` needs.
  "owner",
] as const;
export type ReferenceKind = (typeof referenceKinds)[number];

/** A path into a file's value: keys and list indexes. */
export type ConfigPath = readonly (string | number)[];

/** One thing a file points to, and where in the file it says so. */
export interface Reference {
  readonly kind: ReferenceKind;
  readonly name: string;
  readonly path: ConfigPath;
}

/** Every config file's value has a key, which matches its file name. */
export interface Keyed {
  readonly key: string;
}

/** What a type's own check can read: the system and every other file. */
export interface ConfigCheckContext {
  readonly catalog: ConfigCatalog;
  readonly files: readonly ConfigFile[];
}

/** One problem a type's own check finds, at a path in the file. */
export interface ConfigCheckProblem {
  readonly path: ConfigPath;
  readonly message: string;
}

export interface ConfigType<TValue extends Keyed = Keyed> {
  /** The folder under `config/`, such as `roles`. */
  readonly type: string;
  readonly schema: z.ZodType<TValue>;
  readonly references: (value: TValue) => readonly Reference[];
  /**
   * Checks beyond names: a workflow's steps line up (P2.16). Runs after
   * the schema, on a file that fits it.
   */
  readonly check?: (
    value: TValue,
    context: ConfigCheckContext
  ) => readonly ConfigCheckProblem[];
}

/** Any config type, for lists of them. */
// oxlint-disable-next-line typescript/no-explicit-any -- each type's value differs
export type AnyConfigType = ConfigType<any>;

const typeName = /^[a-z][a-z0-9-]*$/u;

/** Registers a config type: its folder, its schema and its references. */
export const defineConfigType = <TValue extends Keyed>(
  options: ConfigType<TValue>
): ConfigType<TValue> => {
  if (!typeName.test(options.type)) {
    throw new Error(
      `Config type "${options.type}" must be lower case letters, digits and dashes, starting with a letter.`
    );
  }
  return Object.freeze({ ...options });
};
