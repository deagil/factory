// `system.describe`: the objects, fields, actions, queries and events a
// caller may use, with their schemas. The web app builds screens from it and
// agents read it to understand the system (P1.16, decision 0029).
import type {
  AnyField,
  AnyObjectDefinition,
  ChoiceOptions,
} from "@workspace/objects";
import { isChoiceField, isComputedField } from "@workspace/objects";
import { z } from "zod";

import { actionKinds, defineQuery } from "./define-action.ts";
import type {
  AnyActionDefinition,
  AnyDefinition,
  WorkflowEntry,
} from "./define-action.ts";
import { objectEndpoints } from "./generated.ts";
import { everythingRole, grantedBy, mayCall } from "./permissions.ts";
import type { Granted, ObjectGrant } from "./permissions.ts";

const jsonSchema = z.record(z.string(), z.unknown());

const fieldSchema = z.object({
  key: z.string(),
  label: z.string(),
  description: z.string().nullable(),
  type: z.string(),
  required: z.boolean(),
  /** Whether the caller's roles let it read the field, and write it (P2.14). */
  read: z.boolean(),
  write: z.boolean(),
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
  /** A choice field's list: `config/choices/<list>.yaml`. Null otherwise. */
  list: z.string().nullable(),
  /** This field is the record's name, shown for references (decision 0052). */
  display: z.boolean(),
  /** An image field shown before the display value. Null when there isn't one. */
  avatar: z.string().nullable(),
  /**
   * How a computed field is calculated. Null when the field is stored.
   * `fields` are other fields on the same record.
   */
  computed: z
    .object({
      type: z.enum(["text", "number"]),
      using: z.enum(["concat", "coalesce", "add", "subtract", "multiply"]),
      fields: z.array(z.string()),
      separator: z.string().nullable(),
    })
    .nullable(),
  schema: jsonSchema,
});

const definitionSchema = z.object({
  name: z.string(),
  description: z.string(),
  input: jsonSchema,
  output: jsonSchema,
});

const actionSchema = definitionSchema.extend({
  /** `internal` or `external` (decision 0045). */
  kind: z.enum(actionKinds),
  emits: z.array(z.string()),
  /** Its own error codes, with their messages. */
  errors: z.record(z.string(), z.string()),
  /** It only reads, so a `read_only` workflow may run it. Left out when not. */
  readOnly: z.literal(true).optional(),
  /** Inputs a workflow must set with a fixed `value`. Left out when none. */
  fixedInputs: z.array(z.string()).optional(),
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
      /** The owner field, which `rows: own` matches on; null if none. */
      owner: z.string().nullable(),
      /** The caller's rows: `own` or `all` (P2.14). */
      rows: z.enum(["own", "all"]),
      /** The object's REST endpoints the caller may use (decision 0045). */
      endpoints: z.array(
        z.object({
          method: z.enum(["GET", "POST", "PATCH"]),
          path: z.string(),
          name: z.string(),
        })
      ),
    })
  ),
  actions: z.array(actionSchema),
  queries: z.array(definitionSchema),
  events: z.array(z.object({ type: z.string(), payload: jsonSchema })),
  /** The workflows the caller may call, which are endpoints (P2.18). */
  workflows: z.array(
    z.object({
      key: z.string(),
      label: z.string(),
      description: z.string(),
      /** `GET /workflows/<key>` when true, POST otherwise. */
      readOnly: z.boolean(),
      input: jsonSchema,
      /** Its input as fields, as an object's are, for forms. */
      fields: z.array(fieldSchema),
      /** Its declared error codes, with their messages. */
      errors: z.record(z.string(), z.string()),
    })
  ),
  /**
   * The actions workflow steps run (P2.15): never callable, so only a whole
   * system's description, as `fx describe` shows it, lists them.
   */
  stepActions: z.array(actionSchema).optional(),
});

export type SystemDescription = z.infer<typeof describeOutput>;

const toJson = (schema: z.ZodType, io: "input" | "output" = "output") => {
  const { $schema: _, ...rest } = z.toJSONSchema(schema, {
    io,
    unrepresentable: "any",
  });
  return rest;
};

/** A schema as JSON Schema, the same shape `describeAction` gives. */
export const jsonSchemaOf = (
  schema: z.ZodType,
  io: "input" | "output" = "output"
) => toJson(schema, io);

const builtInColumns = new Set(["key", "label", "description", "archived"]);

/** A choice field's options, or null when `field` isn't a choice. */
const choiceOptions = (field: AnyField, choices: ChoiceOptions | undefined) => {
  if (!isChoiceField(field)) {
    return null;
  }
  const { list } = field;
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
  if (!isChoiceField(field)) {
    return null;
  }
  const { columns } = field.list;
  return Object.keys(columns).length > 0
    ? toJson(z.strictObject(columns), "input")
    : null;
};

const describeField = (
  label: string,
  key: string,
  field: AnyField,
  choices: ChoiceOptions | undefined,
  grant: ObjectGrant | null
) => ({
  key,
  label,
  description: field.description ?? null,
  type: field.kind,
  required: field.required,
  read: grant?.read.has(key) ?? false,
  write: isComputedField(field) ? false : (grant?.write.has(key) ?? false),
  target: "target" in field ? String(field.target) : null,
  filters: Object.keys(field.filters),
  display: field.displayField,
  avatar: field.avatar ?? null,
  computed: isComputedField(field)
    ? {
        type: field.result,
        using: field.using,
        fields: [...field.sources],
        separator: field.separator,
      }
    : null,
  options: choiceOptions(field, choices),
  optionColumns: optionColumns(field),
  list: isChoiceField(field) ? field.list.key : null,
  schema: toJson(field.input, "input"),
});

/**
 * A workflow's input or event field, as `system.describe` describes a field.
 * The caller may read and write it: a workflow's fields have no object grant.
 */
export const describeWorkflowField = (
  label: string,
  key: string,
  field: AnyField,
  choices: ChoiceOptions | undefined
) => ({
  ...describeField(label, key, field, choices, null),
  read: true,
  write: true,
});

const describeDefinition = (definition: AnyDefinition) => ({
  name: definition.name,
  description: definition.description,
  input: toJson(definition.input, "input"),
  output: toJson(definition.output),
});

/** One action as `system.describe` shows it, camelCase keys included. */
export const describeAction = (action: AnyActionDefinition) => ({
  ...describeDefinition(action),
  kind: action.kind,
  emits: Object.keys(action.emits),
  errors: { ...action.errors },
  ...(action.readOnly ? { readOnly: true as const } : {}),
  ...(action.fixedInputs.length > 0
    ? { fixedInputs: [...action.fixedInputs] }
    : {}),
});

export interface DescribeOptions {
  objects: readonly AnyObjectDefinition[];
  /** The actions workflow steps run; left out of what callers are told. */
  stepActions?: readonly AnyActionDefinition[];
  /** Every other definition in the system; `system.describe` adds itself. */
  definitions: readonly AnyDefinition[];
  /** Loaded choice lists, so a choice field can name its options (P2.07). */
  choices?: ChoiceOptions | undefined;
  /** Every workflow in the config the caller's call pinned (P2.18). */
  workflows?: readonly WorkflowEntry[] | undefined;
}

/** Grants everything: for describing a whole system, as `fx describe` does. */
export const allGranted: Granted = {
  ...grantedBy([everythingRole]),
  holds: () => false,
};

/** What of `objects` and `definitions` a caller granted `granted` may use. */
export const describeFor = (
  { objects, definitions, choices, stepActions, workflows }: DescribeOptions,
  granted: Granted
): SystemDescription => {
  const usable = definitions.filter(
    (definition) => granted.authorise(definition) === null
  );
  const actions = usable.filter((definition) => definition.kind !== "query");
  const names = new Set(usable.map((definition) => definition.name));
  const events = new Map<string, z.ZodType>();
  for (const action of actions) {
    for (const [type, payload] of Object.entries(action.emits)) {
      events.set(type, payload as z.ZodType);
    }
  }
  return {
    objects: objects
      .filter((object) => granted.on(object) !== null)
      .map((object) => ({
        name: object.name,
        label: object.label,
        description: object.description ?? null,
        fields: Object.entries(object.fields).map(([key, field]) =>
          describeField(
            object.fieldLabels[key] ?? key,
            key,
            field as AnyField,
            choices,
            granted.on(object)
          )
        ),
        owner: object.owner ?? null,
        rows: granted.on(object)?.rows ?? "all",
        list: [...object.list],
        customFields: object.customFields,
        endpoints: objectEndpoints(object)
          .filter((endpoint) => names.has(endpoint.name))
          .map(({ method, path, name }) => ({ method, path, name })),
      })),
    actions: actions.map(describeAction),
    queries: usable
      .filter((definition) => definition.kind === "query")
      .map(describeDefinition),
    events: [...events].map(([type, payload]) => ({
      type,
      payload: toJson(payload),
    })),
    workflows: (workflows ?? [])
      .filter((workflow) => workflow.called && mayCall(granted, workflow.key))
      .map(({ key, label, description, readOnly, input, fields, errors }) => ({
        key,
        label,
        description,
        readOnly,
        input: toJson(input, "input"),
        fields: fields.map((each) =>
          describeWorkflowField(each.label, each.key, each.field, choices)
        ),
        errors: { ...errors },
      })),
    ...(stepActions ? { stepActions: stepActions.map(describeAction) } : {}),
  };
};

/** The `system.describe` query for a system's objects and definitions. */
export const describeQuery = ({ objects, definitions }: DescribeOptions) => {
  const all: AnyDefinition[] = [...definitions];
  const query = defineQuery({
    name: "system.describe",
    description:
      "Describes the objects, fields, actions, queries, events and workflows you may use, with their JSON Schemas.",
    input: z.object({}),
    output: describeOutput,
    everyone: true,
    handler: (ctx): SystemDescription =>
      describeFor(
        {
          objects,
          definitions: all,
          choices: ctx.config.choices,
          workflows: ctx.config.workflows,
        },
        ctx.granted
      ),
  });
  all.push(query);
  return query;
};
