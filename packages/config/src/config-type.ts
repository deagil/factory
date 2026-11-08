// Config types (SYSTEM_DESIGN §4.4, decision 0037). Each type is a folder
// under `config/`, a Zod schema for its files and a list of what each file
// points to, which validateConfig checks against the running code.
import type { z } from "zod";

/** What a config file can point to in the running code or other config. */
export const referenceKinds = [
  "object",
  "field",
  "choice",
  "action",
  "event",
  "template",
  "role",
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

export interface ConfigType<TValue extends Keyed = Keyed> {
  /** The folder under `config/`, such as `roles`. */
  readonly type: string;
  readonly schema: z.ZodType<TValue>;
  readonly references: (value: TValue) => readonly Reference[];
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
