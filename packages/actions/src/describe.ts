// `system.describe`: the objects, fields, actions, queries and events a
// caller may use, with their schemas. The web app builds screens from it and
// agents read it to understand the system (P1.16, decision 0029).
import type {
  AnyField,
  AnyObjectDefinition,
  ChoiceField,
  ChoiceOptions,
} from "@workspace/objects";
import { z } from "zod";

import { defineQuery } from "./define-action.ts";
import type { AnyDefinition } from "./define-action.ts";
import type { Granted } from "./permissions.ts";

const jsonSchema = z.record(z.string(), z.unknown());

const fieldSchema = z.object({
  key: z.string(),
  label: z.string(),
  description: z.string().nullable(),
  type: z.string(),
  required: z.boolean(),
  /** Only hand-written actions can change it. */
  readOnly: z.boolean(),
  /** The object a `ref` field points at. */
  target: z.string().nullable(),
  filters: z.array(z.string()),
  /**
   * A choice field's options, archived ones included so history can still
   * name them. Null when the field isn't a choice.
   */
  options: z
    .array(
      z.object({
        key: z.string(),
        label: z.string(),
        description: z.string().nullable(),
        archived: z.boolean(),
        /** The list's own columns, such as a deal stage's `category`. */
        columns: z.record(z.string(), z.unknown()),
      })
    )
    .nullable(),
  /**
   * A choice list's own columns, as JSON Schema. Null when the field isn't a
   * choice or its list has none.
   */
  optionColumns: jsonSchema.nullable(),
  schema: jsonSchema,
});

const definitionSchema = z.object({
  name: z.string(),
  description: z.string(),
  input: jsonSchema,
  output: jsonSchema,
});

export const describeOutput = z.object({
  objects: z.array(
    z.object({
      name: z.string(),
      label: z.string(),
      description: z.string().nullable(),
      fields: z.array(fieldSchema),
      list: z.array(z.string()),
      customFields: z.boolean(),
    })
  ),
  actions: z.array(definitionSchema.extend({ emits: z.array(z.string()) })),
  queries: z.array(definitionSchema),
  events: z.array(z.object({ type: z.string(), payload: jsonSchema })),
});

export type SystemDescription = z.infer<typeof describeOutput>;

const toJson = (schema: z.ZodType, io: "input" | "output" = "output") => {
  const { $schema: _, ...rest } = z.toJSONSchema(schema, {
    io,
    unrepresentable: "any",
  });
  return rest;
};

const builtInColumns = new Set(["key", "label", "description", "archived"]);

/** A choice field's options, or null when `field` isn't a choice. */
const choiceOptions = (field: AnyField, choices: ChoiceOptions | undefined) => {
  if (field.kind !== "choice") {
    return null;
  }
  const { list } = field as unknown as ChoiceField;
  return (choices?.(list.key) ?? []).map((option) => ({
    key: option.key,
    label: option.label,
    description: option.description ?? null,
    archived: option.archived === true,
    columns: Object.fromEntries(
      Object.entries(option).filter(([name]) => !builtInColumns.has(name))
    ),
  }));
};

/** A choice list's own columns as JSON Schema, or null. */
const optionColumns = (field: AnyField) => {
  if (field.kind !== "choice") {
    return null;
  }
  const { columns } = (field as unknown as ChoiceField).list;
  return Object.keys(columns).length > 0
    ? toJson(z.strictObject(columns), "input")
    : null;
};

const describeField = (
  object: AnyObjectDefinition,
  key: string,
  field: AnyField,
  choices: ChoiceOptions | undefined
) => ({
  key,
  label: object.fieldLabels[key] ?? key,
  description: field.description ?? null,
  type: field.kind,
  required: field.required,
  readOnly: object.actions.update.readOnly.includes(key),
  target: "target" in field ? String(field.target) : null,
  filters: Object.keys(field.filters),
  options: choiceOptions(field, choices),
  optionColumns: optionColumns(field),
  schema: toJson(field.input, "input"),
});

const describeDefinition = (definition: AnyDefinition) => ({
  name: definition.name,
  description: definition.description,
  input: toJson(definition.input, "input"),
  output: toJson(definition.output),
});

export interface DescribeOptions {
  objects: readonly AnyObjectDefinition[];
  /** Every other definition in the system; `system.describe` adds itself. */
  definitions: readonly AnyDefinition[];
  /** Loaded choice lists, so a choice field can name its options (P2.07). */
  choices?: ChoiceOptions | undefined;
}

/** Grants everything: for describing a whole system, as `fx describe` does. */
export const allGranted: Granted = {
  authorise: () => null,
  canRead: () => "all",
  holds: () => false,
};

/** What of `objects` and `definitions` a caller granted `granted` may use. */
export const describeFor = (
  { objects, definitions, choices }: DescribeOptions,
  granted: Granted
): SystemDescription => {
  const usable = definitions.filter(
    (definition) => granted.authorise(definition) === null
  );
  const actions = usable.filter((definition) => definition.kind === "action");
  const events = new Map<string, z.ZodType>();
  for (const action of actions) {
    for (const [type, payload] of Object.entries(action.emits)) {
      events.set(type, payload as z.ZodType);
    }
  }
  return {
    objects: objects
      .filter((object) => granted.canRead(object) === "all")
      .map((object) => ({
        name: object.name,
        label: object.label,
        description: object.description ?? null,
        fields: Object.entries(object.fields).map(([key, field]) =>
          describeField(object, key, field as AnyField, choices)
        ),
        list: [...object.list],
        customFields: object.customFields,
      })),
    actions: actions.map((action) => ({
      ...describeDefinition(action),
      emits: Object.keys(action.emits),
    })),
    queries: usable
      .filter((definition) => definition.kind === "query")
      .map(describeDefinition),
    events: [...events].map(([type, payload]) => ({
      type,
      payload: toJson(payload),
    })),
  };
};

/** The `system.describe` query for a system's objects and definitions. */
export const describeQuery = ({ objects, definitions }: DescribeOptions) => {
  const all: AnyDefinition[] = [...definitions];
  const query = defineQuery({
    name: "system.describe",
    description:
      "Describes the objects, fields, actions, queries and events you may use, with their JSON Schemas.",
    input: z.object({}),
    output: describeOutput,
    everyone: true,
    handler: (ctx): SystemDescription =>
      describeFor(
        { objects, definitions: all, choices: ctx.config.choices },
        ctx.granted
      ),
  });
  all.push(query);
  return query;
};
