// A workflow's `input` and its declared events' payloads use the same field
// types as objects (P2.16, decision 0048): `{ type: ref, object: deal }`,
// `{ type: choice, list: deal_stages }`, `{ type: email }`.
// Each becomes the object field of that type, so a workflow's input checks
// values exactly as a record's fields do. Fields are required unless
// `optional: true`, as a function's parameters are.
import { defineChoiceList, f } from "@workspace/objects";
import type { AnyField } from "@workspace/objects";
import { z } from "zod";

/** snake_case: a workflow, step, event, error, role or field name. */
export const snakeCase = z
  .string()
  .regex(
    /^[a-z][a-z0-9]*(?:_[a-z0-9]+)*$/u,
    "Use snake_case: lower case letters and digits joined by single underscores, starting with a letter"
  );

const common = {
  /** The caller may leave it out. Fields are required otherwise. */
  optional: z.boolean().optional(),
  label: z.string().min(1).max(200).optional(),
  description: z.string().min(1).max(500).optional(),
};

export const fieldSpecSchema = z.discriminatedUnion("type", [
  z.strictObject({
    type: z.literal("text"),
    max_length: z.int().positive().optional(),
    ...common,
  }),
  z.strictObject({
    type: z.literal("email"),
    max_length: z.int().positive().optional(),
    ...common,
  }),
  z.strictObject({
    type: z.literal("url"),
    max_length: z.int().positive().optional(),
    ...common,
  }),
  z.strictObject({
    type: z.literal("number"),
    integer: z.boolean().optional(),
    min: z.number().optional(),
    max: z.number().optional(),
    ...common,
  }),
  z.strictObject({
    type: z.literal("money"),
    currency: z.string().length(3).optional(),
    ...common,
  }),
  z.strictObject({ type: z.literal("date"), ...common }),
  z.strictObject({ type: z.literal("boolean"), ...common }),
  z.strictObject({ type: z.literal("ref"), object: snakeCase, ...common }),
  z.strictObject({ type: z.literal("choice"), list: snakeCase, ...common }),
]);

export type FieldSpec = z.infer<typeof fieldSpecSchema>;

/** Field specs by name, as `input` and each event's payload hold them. */
export type FieldSpecs = Readonly<Record<string, FieldSpec>>;

/** The object field a spec describes. */
export const fieldOf = (spec: FieldSpec): AnyField => {
  const options = {
    required: !spec.optional,
    label: spec.label,
    description: spec.description,
  };
  switch (spec.type) {
    case "text": {
      return f.text({ ...options, maxLength: spec.max_length });
    }
    case "email": {
      return f.email({ ...options, maxLength: spec.max_length });
    }
    case "url": {
      return f.url({ ...options, maxLength: spec.max_length });
    }
    case "number": {
      return f.number({
        ...options,
        integer: spec.integer,
        min: spec.min,
        max: spec.max,
      });
    }
    case "money": {
      return f.money({ ...options, currency: spec.currency });
    }
    case "date": {
      return f.date(options);
    }
    case "boolean": {
      return f.boolean(options);
    }
    case "ref": {
      return f.ref(spec.object, options);
    }
    case "choice": {
      // The options are config; the repository checks a key against them.
      return f.choice(defineChoiceList({ key: spec.list }), options);
    }
    default: {
      const unknown: never = spec;
      return unknown;
    }
  }
};

/** What `specs` take, as one Zod object: a workflow's input or an event. */
export const schemaOf = (specs: FieldSpecs = {}): z.ZodObject =>
  z.strictObject(
    Object.fromEntries(
      Object.entries(specs).map(([name, spec]) => {
        const { input } = fieldOf(spec);
        return [name, spec.optional ? input.optional() : input];
      })
    )
  );
