// `system.describe`: the objects, fields, actions, queries and events a
// caller may use, with their schemas. The web app builds screens from it and
// agents read it to understand the system (P1.16, decision 0029).
import type { AnyField, AnyObjectDefinition } from "@workspace/objects";
import { z } from "zod";

import { defineQuery } from "./define-action.ts";
import type { AnyDefinition } from "./define-action.ts";

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

const describeField = (
  object: AnyObjectDefinition,
  key: string,
  field: AnyField
) => ({
  key,
  label: object.fieldLabels[key] ?? key,
  description: field.description ?? null,
  type: field.kind,
  required: field.required,
  readOnly: object.actions.update.readOnly.includes(key),
  target: "target" in field ? String(field.target) : null,
  filters: Object.keys(field.filters),
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
}

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
    handler: (ctx): SystemDescription => {
      const usable = all.filter(
        (definition) => ctx.granted.authorise(definition) === null
      );
      const actions = usable.filter(
        (definition) => definition.kind === "action"
      );
      const events = new Map<string, z.ZodType>();
      for (const action of actions) {
        for (const [type, payload] of Object.entries(action.emits)) {
          events.set(type, payload as z.ZodType);
        }
      }
      return {
        objects: objects
          .filter((object) => ctx.granted.canRead(object) === "all")
          .map((object) => ({
            name: object.name,
            label: object.label,
            description: object.description ?? null,
            fields: Object.entries(object.fields).map(([key, field]) =>
              describeField(object, key, field as AnyField)
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
    },
  });
  all.push(query);
  return query;
};
