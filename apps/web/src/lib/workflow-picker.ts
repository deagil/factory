// What a value in a step may read, as the choices of the data picker: the
// input's or event's fields and the output of each step that has run by
// then, from the scopes the check returns. Nothing is offered that the
// check would refuse.
import type { Source, WorkflowCheck } from "@workspace/workflows";

import { pathWords } from "./workflow-words.ts";

type Scopes = WorkflowCheck["scopes"];
type ScopeField = NonNullable<Scopes["input"]>[number];
/** What a fixed value in the file may be. */
export type Fixed = Extract<Source, { value: unknown }>["value"];

export interface PickerOption {
  /** `input.deal`, `steps.load.output.record.stage`: what the file holds. */
  path: string;
  words: string;
  /** `string`, `number`, `boolean`, `object`, `array`, or `any` when unknown. */
  type: string;
  /** Whether its type suits the input it would fill. */
  fits: boolean;
}

export interface PickerGroup {
  title: string;
  options: PickerOption[];
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

/** The schema itself, or the part of a nullable one that isn't null. */
const solid = (schema: unknown): Record<string, unknown> => {
  if (!isRecord(schema)) {
    return {};
  }
  const anyOf = Array.isArray(schema.anyOf) ? schema.anyOf : [];
  const member = anyOf.find((each) => isRecord(each) && each.type !== "null");
  return isRecord(member) ? member : schema;
};

/** A JSON Schema's type as one word. */
export const schemaType = (schema: unknown): string => {
  const { type } = solid(schema);
  if (Array.isArray(type)) {
    const named = type.find((each) => each !== "null");
    return typeof named === "string" ? named : "any";
  }
  if (typeof type !== "string") {
    return "any";
  }
  return type === "integer" ? "number" : type;
};

const fieldTypes: Record<string, string> = {
  number: "number",
  integer: "number",
  currency: "number",
  boolean: "boolean",
  json: "any",
};

/** A described field's type as a JSON Schema type would name it. */
const fieldType = (field: ScopeField) => fieldTypes[field.type] ?? "string";

const fitsType = (type: string, target: string) =>
  type === "any" || target === "any" || type === target;

const depthLimit = 4;

const under = (
  base: string,
  schema: unknown,
  target: string,
  depth: number
): PickerOption[] => {
  const { properties } = solid(schema);
  if (!isRecord(properties) || depth >= depthLimit) {
    return [];
  }
  return Object.entries(properties).flatMap(([key, inner]) => {
    const path = `${base}.${key}`;
    const type = schemaType(inner);
    return [
      { path, words: pathWords(path), type, fits: fitsType(type, target) },
      ...under(path, inner, target, depth + 1),
    ];
  });
};

const fromFields = (
  root: "input" | "event",
  fields: readonly ScopeField[],
  target: string
): PickerOption[] =>
  fields.flatMap((field) => {
    const path = `${root}.${field.key}`;
    const type = fieldType(field);
    return [
      { path, words: pathWords(path), type, fits: fitsType(type, target) },
      // A choice's own columns, such as a stage's category.
      ...under(path, field.optionColumns, target, depthLimit - 1),
    ];
  });

const stepGroup = (
  scopes: Scopes,
  id: string,
  target: string
): PickerGroup | null => {
  const schema = scopes.outputs[id];
  if (schema === undefined) {
    return null;
  }
  const path = `steps.${id}.output`;
  const type = schemaType(schema);
  return {
    title: `The step ${id}`,
    options: [
      { path, words: pathWords(path), type, fits: fitsType(type, target) },
      ...under(path, schema, target, 0),
    ],
  };
};

/**
 * Everything the step at `stepPath` may read, in groups. `target` is the
 * JSON Schema of the input being filled, when it is known.
 */
export const pickerGroups = (
  scopes: Scopes | undefined,
  stepPath: string,
  target?: unknown
): PickerGroup[] => {
  if (!scopes) {
    return [];
  }
  const want = target === undefined ? "any" : schemaType(target);
  const start: PickerGroup[] = [
    ...(scopes.input
      ? [
          {
            title: "What the workflow takes",
            options: fromFields("input", scopes.input, want),
          },
        ]
      : []),
    ...(scopes.event
      ? [
          {
            title: "The event that starts it",
            options: fromFields("event", scopes.event, want),
          },
        ]
      : []),
    ...(scopes.eventSchema === null
      ? []
      : [
          {
            title: "The event that starts it",
            options: under("event", scopes.eventSchema, want, 0),
          },
        ]),
  ];
  const steps = (scopes.steps[stepPath] ?? []).flatMap((id) => {
    const group = stepGroup(scopes, id, want);
    return group ? [group] : [];
  });
  return [...start, ...steps].filter((group) => group.options.length > 0);
};

/** The groups split in two: what suits the input, and what may not. */
export const splitByFit = (
  groups: readonly PickerGroup[]
): { fits: PickerGroup[]; rest: PickerOption[] } => ({
  fits: groups
    .map((group) => ({
      title: group.title,
      options: group.options.filter((option) => option.fits),
    }))
    .filter((group) => group.options.length > 0),
  rest: groups.flatMap((group) =>
    group.options.filter((option) => !option.fits)
  ),
});

/** A fixed value as the text of its field. */
export const fixedText = (value: unknown): string => {
  if (typeof value === "string") {
    return value;
  }
  return value === undefined ? "" : JSON.stringify(value);
};

/** The text of a fixed value's field as the value the file holds. */
export const fixedValue = (text: string, type: string): Fixed => {
  if (type === "number") {
    const number = Number(text);
    return text.trim() !== "" && Number.isFinite(number) ? number : text;
  }
  if (type === "boolean") {
    return text === "true";
  }
  if (type === "object" || type === "array") {
    try {
      return JSON.parse(text) as Fixed;
    } catch {
      return text;
    }
  }
  return text;
};

/** The options a fixed value must be one of, when the input lists them. */
export const fixedChoices = (target: unknown): string[] | null => {
  const choices = solid(target).enum;
  return Array.isArray(choices) &&
    choices.every((each) => typeof each === "string")
    ? choices
    : null;
};

/** The schema of one input of an action, or undefined when it doesn't say. */
export const inputSchema = (input: unknown, name: string): unknown => {
  const { properties } = solid(input);
  return isRecord(properties) ? properties[name] : undefined;
};

/** The groups with only the options the search words are in. */
export const searched = (
  groups: readonly PickerGroup[],
  search: string
): PickerGroup[] => {
  const words = search.trim().toLowerCase().split(/\s+/u).filter(Boolean);
  const has = (option: PickerOption) => {
    const text = `${option.words} ${option.path}`.toLowerCase();
    return words.every((word) => text.includes(word));
  };
  return groups
    .map((group) => ({ ...group, options: group.options.filter(has) }))
    .filter((group) => group.options.length > 0);
};
