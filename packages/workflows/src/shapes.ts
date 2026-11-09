// What a value in a workflow is, for checking that steps line up (P2.16).
// Every schema becomes JSON Schema, the form `system_describe` already
// gives agents, and two values match when their JSON types do. Types are
// compared loosely on purpose: a whole number fits a number, and anything
// whose type can't be told fits anything.
import { z } from "zod";

/** A JSON Schema node. */
export type Json = Readonly<Record<string, unknown>>;

/** A schema's JSON Schema, as a caller sends it or as it comes back. */
export const jsonOf = (schema: z.ZodType, io: "input" | "output"): Json => {
  const { $schema: _, ...rest } = z.toJSONSchema(schema, {
    io,
    unrepresentable: "any",
  });
  return rest;
};

/** A node's alternatives, leaving out null. */
const alternatives = (node: Json): Json[] => {
  const options = (node.anyOf ?? node.oneOf) as Json[] | undefined;
  if (!options) {
    return [node];
  }
  return options
    .filter((option) => option.type !== "null")
    .flatMap((option) => alternatives(option));
};

const baseType = (node: Json): string => {
  const types = (Array.isArray(node.type) ? node.type : [node.type]).filter(
    (type) => type !== "null"
  );
  const [type] = types;
  if (types.length !== 1 || typeof type !== "string") {
    return "anything";
  }
  return type === "integer" ? "number" : type;
};

/**
 * The JSON type a node holds: string, number, boolean, object, array, or
 * `anything` when it may be more than one or can't be told.
 */
export const typeOf = (node: Json): string => {
  const types = new Set(alternatives(node).map((each) => baseType(each)));
  const [type] = types;
  return types.size === 1 && type ? type : "anything";
};

/** A value's JSON type. */
export const typeOfValue = (value: unknown): string => {
  if (value === null) {
    return "null";
  }
  if (Array.isArray(value)) {
    return "array";
  }
  return typeof value;
};

/** Whether a node takes null. */
export const takesNull = (node: Json): boolean => {
  const options = (node.anyOf ?? node.oneOf) as Json[] | undefined;
  if (options) {
    return options.some((option) => takesNull(option));
  }
  return (
    node.type === "null" ||
    (Array.isArray(node.type) && node.type.includes("null")) ||
    typeOf(node) === "anything"
  );
};

/** The values a node allows, when it lists them. */
export const allowedValues = (node: Json): readonly unknown[] | null => {
  for (const each of alternatives(node)) {
    if (Array.isArray(each.enum)) {
      return each.enum;
    }
    if (Object.hasOwn(each, "const")) {
      return [each.const];
    }
  }
  return null;
};

/** The node under `key`, or undefined when there's none. */
export const childOf = (node: Json, key: string): Json | undefined => {
  for (const each of alternatives(node)) {
    if (typeOf(each) === "anything") {
      return {};
    }
    const properties = each.properties as Record<string, Json> | undefined;
    if (properties && Object.hasOwn(properties, key)) {
      return properties[key];
    }
    if (
      typeof each.additionalProperties === "object" &&
      each.additionalProperties !== null
    ) {
      return each.additionalProperties as Json;
    }
  }
  return undefined;
};

/** The keys a node names, for messages. */
export const keysOf = (node: Json): string[] =>
  alternatives(node).flatMap((each) =>
    Object.keys((each.properties as Record<string, Json> | undefined) ?? {})
  );

const typeNames: Record<string, string> = {
  string: "text",
  number: "a number",
  boolean: "true or false",
  object: "a set of fields",
  array: "a list",
  null: "empty",
  anything: "anything",
};

/** A JSON type in plain words, such as "a number". */
export const typeName = (type: string) => typeNames[type] ?? type;

/** Why a `source` value doesn't fit `target`, or null when it does. */
export const mismatch = (source: Json, target: Json): string | null => {
  const from = typeOf(source);
  const to = typeOf(target);
  return from === "anything" || to === "anything" || from === to
    ? null
    : `takes ${typeName(to)}`;
};

/**
 * What `target` holds, when a fixed value doesn't fit it, such as "a
 * number" or `one of "open", "won"`; null when it fits.
 */
export const expectedFor = (value: unknown, target: Json): string | null => {
  const type = typeOfValue(value);
  const to = typeOf(target);
  if (type === "null") {
    return takesNull(target) ? null : "a value";
  }
  if (to !== "anything" && type !== to) {
    return typeName(to);
  }
  const allowed = allowedValues(target);
  return allowed && !allowed.includes(value)
    ? `one of ${allowed.map((each) => JSON.stringify(each)).join(", ")}`
    : null;
};
