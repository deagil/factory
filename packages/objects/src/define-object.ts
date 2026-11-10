// defineObject: one definition gives a real Drizzle table, the schemas that
// validate records, and the options generated actions read. See
// docs/SYSTEM_DESIGN.md sections 3 and 4.1, and decisions 0005 and 0014.

// The schema entry point only: drizzle-kit loads object files as CommonJS,
// where the rest of @workspace/db (which uses import.meta) fails.
import { actors } from "@workspace/db/schema";
import { sql } from "drizzle-orm";
import type { BuildColumns, BuildExtraConfigColumns } from "drizzle-orm";
import {
  index,
  integer,
  jsonb,
  pgTable,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";
import type {
  ExtraConfigColumn,
  PgColumn,
  PgColumnBuilderBase,
  PgTable,
  PgTableExtraConfigValue,
  PgTableWithColumns,
  PgUUIDBuilder,
} from "drizzle-orm/pg-core";
import { z } from "zod";

import { isComputedField, textSourceKinds } from "./fields/computed.ts";
import type { AnyField, BuiltColumns, ValueOf } from "./fields/field.ts";
import {
  identifierPattern,
  labelFor,
  snakeCase,
  tableNameFor,
} from "./naming.ts";
import { getObject, registerObject } from "./registry.ts";

// Housekeeping columns, on every object table.

const timestamptz = (name: string) => timestamp(name, { withTimezone: true });

const housekeepingColumns = () => ({
  id: uuid("id")
    .primaryKey()
    .default(sql`uuidv7()`),
  createdAt: timestamptz("created_at").notNull().defaultNow(),
  updatedAt: timestamptz("updated_at").notNull().defaultNow(),
  createdBy: uuid("created_by")
    .notNull()
    .references(() => actors.id),
  updatedBy: uuid("updated_by")
    .notNull()
    .references(() => actors.id),
  /** Records are archived, not deleted. */
  archivedAt: timestamptz("archived_at"),
  /** Goes up by one on every update, for optimistic concurrency. */
  version: integer("version").notNull().default(1),
});

const customFieldsColumns = () => ({
  /** Fields staff add through config, by key. */
  customFields: jsonb("custom_fields")
    .$type<Record<string, unknown>>()
    .notNull()
    .default({}),
});

type HousekeepingColumns = ReturnType<typeof housekeepingColumns>;
type CustomFieldsColumns = ReturnType<typeof customFieldsColumns>;

/** Table property names the core uses. A field can't take one. */
export const housekeepingKeys = [
  ...Object.keys(housekeepingColumns()),
  ...Object.keys(customFieldsColumns()),
] as const;

/** Core table names from SYSTEM_DESIGN section 3. An object can't take one. */
export const coreTableNames = [
  "users",
  "actors",
  "actor_roles",
  "api_keys",
  "action_log",
  "audit_log",
  "approvals",
  "approval_decisions",
  "event_log",
  "workflow_runs",
  "workflow_step_runs",
  "config_versions",
  "drafts",
] as const;

// Types.

/** The fields of an object, by key. */
export type ObjectFields = Record<string, AnyField>;

type FieldKey<TFields extends ObjectFields> = keyof TFields & string;

type ColumnsOf<TField extends AnyField> = ReturnType<TField["columns"]>;

type UnionToIntersection<U> = (
  U extends unknown ? (arg: U) => void : never
) extends (arg: infer I) => void
  ? I
  : never;

type Simplify<T> = { [K in keyof T]: T[K] };

/** A field `value` with column suffixes "" and "Currency" gives the properties `value` and `valueCurrency`. */
type FieldTableColumns<TFields extends ObjectFields> = UnionToIntersection<
  {
    [K in FieldKey<TFields>]: {
      [S in keyof ColumnsOf<TFields[K]> & string as `${K}${S}`]: ColumnsOf<
        TFields[K]
      >[S];
    };
  }[FieldKey<TFields>]
>;

/** Every column builder an object's table has, by property. */
export type ObjectColumns<
  TFields extends ObjectFields,
  TCustomFields extends boolean,
> = Extract<
  Simplify<
    HousekeepingColumns &
      FieldTableColumns<TFields> &
      (TCustomFields extends true ? CustomFieldsColumns : unknown)
  >,
  Record<string, PgColumnBuilderBase>
>;

/** The Drizzle table an object gets. */
export type ObjectTable<
  TFields extends ObjectFields,
  TCustomFields extends boolean,
> = PgTableWithColumns<{
  name: string;
  schema: undefined;
  columns: BuildColumns<string, ObjectColumns<TFields, TCustomFields>, "pg">;
  dialect: "pg";
}>;

/** Fields a create or update can set. A computed field is calculated on read. */
type InputKey<TFields extends ObjectFields> = {
  [K in FieldKey<TFields>]: TFields[K]["kind"] extends "computed" ? never : K;
}[FieldKey<TFields>];

type RequiredKeys<TFields extends ObjectFields> = {
  [K in InputKey<TFields>]: TFields[K]["required"] extends true ? K : never;
}[InputKey<TFields>];

type OptionalKeys<TFields extends ObjectFields> = Exclude<
  InputKey<TFields>,
  RequiredKeys<TFields>
>;

/** What a create takes: required fields must be there; others may be left out. */
export type CreateInput<TFields extends ObjectFields> = Simplify<
  { [K in RequiredKeys<TFields>]: ValueOf<TFields[K]> } & {
    [K in OptionalKeys<TFields>]?: ValueOf<TFields[K]>;
  }
>;

/** What an update takes: any stored field; role rules say which (P2.14). */
export type UpdateInput<TFields extends ObjectFields> = Simplify<{
  [K in InputKey<TFields>]?: ValueOf<TFields[K]>;
}>;

/** A record as reads return it. Timestamps are ISO 8601 strings. */
export type ObjectRecord<
  TFields extends ObjectFields,
  TCustomFields extends boolean,
> = Simplify<
  {
    id: string;
    createdAt: string;
    updatedAt: string;
    createdBy: string;
    updatedBy: string;
    archivedAt: string | null;
    version: number;
  } & {
    [K in FieldKey<TFields>]: ValueOf<TFields[K]>;
  } & (TCustomFields extends true
      ? { customFields: Record<string, unknown> }
      : unknown)
>;

/**
 * Who does one of the generated jobs. `false` switches it off. A string names
 * the hand-written action that owns the job, which also switches the
 * generated one off.
 */
type JobOption = false | string;

/** Options for the generated create, update and archive actions. */
export interface ObjectActionsOptions {
  create?: JobOption;
  update?: JobOption;
  archive?: JobOption;
}

export interface ObjectOptions<
  TName extends string,
  TFields extends ObjectFields,
  TCustomFields extends boolean,
> {
  /** snake_case and unique, such as `deal`. Endpoint names start with it. */
  name: TName;
  /** What people see. Defaults to the name, as words. */
  label?: string;
  description?: string;
  /** The table name. Defaults to the plural of the name in snake case. */
  table?: string;
  fields: TFields;
  /** Adds a `custom_fields` JSONB column for fields staff add through config. */
  customFields?: TCustomFields;
  /** The fields list screens show, in order. Defaults to the first five. */
  list?: readonly FieldKey<TFields>[];
  /**
   * The field naming the record's owner, a ref to an actor, such as
   * `owner`. A role with `rows: own` on the object sees and changes only
   * the records it owns (P2.14).
   */
  owner?: FieldKey<TFields>;
  actions?: ObjectActionsOptions;
  /** Plain Drizzle for anything else on the table, such as indexes. */
  drizzle?: (
    table: BuildExtraConfigColumns<
      string,
      ObjectColumns<TFields, TCustomFields>,
      "pg"
    >
  ) => PgTableExtraConfigValue[];
}

/** One generated job, after defaults. */
export interface ObjectJob {
  /** Whether the generated action exists. */
  readonly generated: boolean;
  /** The hand-written action that owns the job, if one does. */
  readonly ownedBy: string | undefined;
}

export interface ObjectActions {
  readonly create: ObjectJob;
  readonly update: ObjectJob;
  readonly archive: ObjectJob;
}

export interface ObjectDefinition<
  TName extends string = string,
  TFields extends ObjectFields = ObjectFields,
  TCustomFields extends boolean = boolean,
> {
  readonly name: TName;
  readonly label: string;
  readonly description: string | undefined;
  readonly tableName: string;
  readonly table: ObjectTable<TFields, TCustomFields>;
  readonly fields: TFields;
  /** Each field's label: its own, or its key as words. */
  readonly fieldLabels: Readonly<Record<FieldKey<TFields>, string>>;
  readonly customFields: TCustomFields;
  readonly list: readonly FieldKey<TFields>[];
  /** The owner field, if the object has one. */
  readonly owner: FieldKey<TFields> | undefined;
  readonly actions: ObjectActions;
  readonly schemas: {
    readonly create: z.ZodType<CreateInput<TFields>>;
    readonly update: z.ZodType<UpdateInput<TFields>>;
    readonly record: z.ZodType<ObjectRecord<TFields, TCustomFields>>;
  };
  /** A field's columns on the table, keyed by suffix, for filters and sorts. */
  readonly columnsOf: (
    key: FieldKey<TFields>
  ) => BuiltColumns<Record<string, PgColumnBuilderBase>>;
  /** Column values for the fields in `values`, ready to insert or update. */
  readonly toRow: (
    values: Partial<Record<FieldKey<TFields>, unknown>>
  ) => Record<string, unknown>;
  /** A record from a row the table returned. */
  readonly fromRow: (
    row: Record<string, unknown>
  ) => ObjectRecord<TFields, TCustomFields>;
}

/* oxlint-disable typescript/no-explicit-any -- AnyObjectDefinition is the
   widest definition: its functions take any, so every object's fit it. */
/** Any object definition. */
export interface AnyObjectDefinition {
  readonly name: string;
  readonly label: string;
  readonly description: string | undefined;
  readonly tableName: string;
  readonly table: PgTable;
  readonly fields: ObjectFields;
  readonly fieldLabels: Readonly<Record<string, string>>;
  readonly customFields: boolean;
  readonly list: readonly string[];
  readonly owner: string | undefined;
  readonly actions: ObjectActions;
  readonly schemas: {
    readonly create: z.ZodType;
    readonly update: z.ZodType;
    readonly record: z.ZodType;
  };
  readonly columnsOf: (
    key: any
  ) => BuiltColumns<Record<string, PgColumnBuilderBase>>;
  readonly toRow: (values: any) => Record<string, unknown>;
  readonly fromRow: (row: Record<string, unknown>) => Record<string, unknown>;
}
/* oxlint-enable typescript/no-explicit-any */

// defineObject.

const fail = (objectName: string, message: string): never => {
  throw new Error(`defineObject("${objectName}"): ${message}`);
};

const jobFrom = (option: JobOption | undefined): ObjectJob => {
  if (option === false) {
    return { generated: false, ownedBy: undefined };
  }
  if (typeof option === "string") {
    return { generated: false, ownedBy: option };
  }
  return { generated: true, ownedBy: undefined };
};

/** snake_case (decision 0047), or the dotted names still in code until P2.26. */
const actionNamePattern =
  /^(?:[a-z][a-z0-9]*(?:_[a-z0-9]+)*|[a-z][a-zA-Z0-9]*\.[a-z][a-zA-Z0-9]*)$/u;

/** Checks field keys, and that no two fields need the same property or column. */
const checkFields = (name: string, fields: ObjectFields): string[] => {
  const keys = Object.keys(fields);
  if (keys.length === 0) {
    fail(name, "an object needs at least one field");
  }
  const properties = new Map<string, string>(
    housekeepingKeys.map((key) => [key, "a housekeeping column"])
  );
  const columns = new Map<string, string>();
  for (const key of keys) {
    if (!identifierPattern.test(key)) {
      fail(
        name,
        `the field "${key}" must be camelCase, starting with a lowercase letter`
      );
    }
    const field = fields[key] as AnyField;
    const builders = field.columns(snakeCase(key));
    for (const [suffix, builder] of Object.entries(builders)) {
      const property = `${key}${suffix}`;
      const taken = properties.get(property);
      if (taken) {
        fail(
          name,
          `the field "${key}" needs the property "${property}", which is ${taken}`
        );
      }
      properties.set(property, `used by the field "${key}"`);
      const column = (builder as unknown as { config: { name: string } }).config
        .name;
      const clash = columns.get(column);
      if (clash) {
        fail(
          name,
          `the fields "${clash}" and "${key}" both need the column "${column}"`
        );
      }
      columns.set(column, key);
    }
  }
  return keys;
};

/** One display field, and an avatar that names an image field. */
const checkPresentation = (
  name: string,
  fields: ObjectFields,
  keys: string[]
) => {
  const marked = keys.filter((key) => (fields[key] as AnyField).displayField);
  if (marked.length > 1) {
    fail(
      name,
      `only one field can be the display field (${marked.join(", ")} are)`
    );
  }
  const [displayKey] = marked;
  const display = displayKey ? (fields[displayKey] as AnyField) : undefined;
  if (display && (display.kind === "ref" || display.kind === "image")) {
    fail(
      name,
      `the display field "${displayKey}" can't be a ${display.kind} field`
    );
  }
  for (const key of keys) {
    const { avatar } = fields[key] as AnyField;
    if (!avatar) {
      continue;
    }
    if (key !== displayKey) {
      fail(
        name,
        `only the display field can name an avatar, and "${key}" does`
      );
    }
    const image = fields[avatar] as AnyField | undefined;
    if (!image) {
      fail(name, `the display field's avatar "${avatar}" isn't a field`);
    } else if (image.kind !== "image") {
      fail(name, `the display field's avatar "${avatar}" isn't an image field`);
    }
  }
};

/** A computed field reads stored fields of the shape its operation returns. */
const checkComputedFields = (
  name: string,
  fields: ObjectFields,
  keys: string[]
) => {
  for (const key of keys) {
    const field = fields[key] as AnyField;
    if (!isComputedField(field)) {
      continue;
    }
    for (const source of field.sources) {
      if (source === key) {
        fail(name, `"${key}" can't read itself`);
      }
      const other = fields[source] as AnyField | undefined;
      if (!other) {
        fail(name, `"${key}" reads "${source}", which isn't a field`);
      } else if (isComputedField(other)) {
        fail(
          name,
          `"${key}" reads "${source}", and a computed field reads stored fields`
        );
      } else if (
        !(field.result === "text"
          ? textSourceKinds.has(other.kind)
          : other.kind === "number")
      ) {
        fail(
          name,
          `"${key}" combines ${field.result} fields with ${field.using}, and "${source}" is ${other.kind}`
        );
      }
    }
  }
};

const checkOptions = (
  options: ObjectOptions<string, ObjectFields, boolean>
) => {
  const { name } = options;
  if (!identifierPattern.test(name)) {
    fail(name, "the name must be camelCase, starting with a lowercase letter");
  }
  const keys = checkFields(name, options.fields);
  checkPresentation(name, options.fields, keys);
  checkComputedFields(name, options.fields, keys);
  for (const key of options.list ?? []) {
    if (!keys.includes(key)) {
      fail(name, `list names "${key}", which isn't a field`);
    }
  }
  if (options.owner !== undefined) {
    const owner = options.fields[options.owner] as
      | (AnyField & { target?: string })
      | undefined;
    if (owner?.kind !== "ref" || owner.target !== "actor") {
      fail(
        name,
        `owner names "${options.owner}", which isn't a ref to an actor, such as owner: f.ref("actor")`
      );
    }
  }
  for (const job of ["create", "update", "archive"] as const) {
    const owner = options.actions?.[job];
    if (typeof owner === "string" && !actionNamePattern.test(owner)) {
      fail(
        name,
        `actions.${job} must be false or an action name such as "${name}_place", not "${owner}"`
      );
    }
  }
  const tableName = options.table ?? tableNameFor(name);
  if ((coreTableNames as readonly string[]).includes(tableName)) {
    fail(
      name,
      `the table "${tableName}" is a core table. Pass a different \`table\`.`
    );
  }
  return { keys, tableName };
};

/** A timestamp from the driver as ISO 8601; null stays null. */
const iso = (value: unknown) =>
  value instanceof Date ? value.toISOString() : (value as string | null);

/** The table a ref points at: the actors table, or another object's. */
const refTarget = (from: string, target: string) => {
  if (target === "actor") {
    return actors;
  }
  const object = getObject(target);
  if (!object) {
    throw new Error(
      `defineObject("${from}"): a ref points at "${target}", which isn't a defined object. Define it, or point at "actor".`
    );
  }
  return object.table as unknown as PgTableWithColumns<{
    name: string;
    schema: undefined;
    columns: { id: PgColumn };
    dialect: "pg";
  }>;
};

/**
 * Defines an object: a record type with its own table. The result is
 * registered by name, so refs can point at it.
 */
export const defineObject = <
  const TName extends string,
  TFields extends ObjectFields,
  TCustomFields extends boolean = false,
>(
  options: ObjectOptions<TName, TFields, TCustomFields>
): ObjectDefinition<TName, TFields, TCustomFields> => {
  const { name, fields } = options;
  const { keys, tableName } = checkOptions(
    options as unknown as ObjectOptions<string, ObjectFields, boolean>
  );
  const customFields = (options.customFields ?? false) as TCustomFields;

  // Columns: housekeeping, then each field's, then custom fields.
  const columns: Record<string, PgColumnBuilderBase> = housekeepingColumns();
  const refColumns: string[] = [];
  const choiceColumns: string[] = [];
  for (const key of keys) {
    const field = fields[key] as AnyField;
    const builders = field.columns(snakeCase(key));
    if (field.kind === "ref") {
      const { target } = field as AnyField & { target: string };
      (builders[""] as PgUUIDBuilder<never>).references(
        () => refTarget(name, target).id
      );
      refColumns.push(key);
    }
    if (field.kind === "choice") {
      choiceColumns.push(key);
    }
    for (const [suffix, builder] of Object.entries(builders)) {
      columns[`${key}${suffix}`] = builder;
    }
  }
  if (customFields) {
    Object.assign(columns, customFieldsColumns());
  }

  const table = pgTable(tableName, columns, (t) => {
    const built = (key: string) => t[key] as ExtraConfigColumn;
    return [
      // Refs are joined and filtered on, so each gets an index.
      ...refColumns.map((key) =>
        index(`${tableName}_${snakeCase(key)}_id_idx`).on(built(key))
      ),
      // So are choices, by key or by a category's keys (decision 0039).
      ...choiceColumns.map((key) =>
        index(`${tableName}_${snakeCase(key)}_idx`).on(built(key))
      ),
      ...(customFields
        ? [
            index(`${tableName}_custom_fields_idx`).using(
              "gin",
              built("customFields")
            ),
          ]
        : []),
      ...(options.drizzle?.(t as never) ?? []),
    ];
  }) as unknown as ObjectTable<TFields, TCustomFields>;

  // Labels and options.
  const fieldLabels = Object.fromEntries(
    keys.map((key) => [key, (fields[key] as AnyField).label ?? labelFor(key)])
  ) as Record<FieldKey<TFields>, string>;
  const list = (options.list ?? keys.slice(0, 5)) as FieldKey<TFields>[];
  const actions: ObjectActions = {
    create: jobFrom(options.actions?.create),
    update: jobFrom(options.actions?.update),
    archive: jobFrom(options.actions?.archive),
  };

  // Schemas.
  const createShape: Record<string, z.ZodType> = {};
  const updateShape: Record<string, z.ZodType> = {};
  const recordShape: Record<string, z.ZodType> = {
    id: z.uuid(),
    createdAt: z.iso.datetime({ offset: true }),
    updatedAt: z.iso.datetime({ offset: true }),
    createdBy: z.uuid(),
    updatedBy: z.uuid(),
    archivedAt: z.iso.datetime({ offset: true }).nullable(),
    version: z.int(),
  };
  for (const key of keys) {
    const field = fields[key] as AnyField;
    recordShape[key] = field.output;
    if (isComputedField(field)) {
      continue;
    }
    createShape[key] = field.required ? field.input : field.input.optional();
    updateShape[key] = field.input.optional();
  }
  if (customFields) {
    recordShape.customFields = z.record(z.string(), z.unknown());
  }
  const schemas = {
    create: z.strictObject(createShape),
    update: z.strictObject(updateShape),
    record: z.strictObject(recordShape),
  } as unknown as ObjectDefinition<TName, TFields, TCustomFields>["schemas"];

  // Mapping between field values and columns.
  const tableColumns = table as unknown as Record<string, PgColumn>;
  const suffixesOf = (key: string) =>
    Object.keys((fields[key] as AnyField).columns(snakeCase(key)));
  const suffixes = new Map(keys.map((key) => [key, suffixesOf(key)]));

  const columnsOf = (key: FieldKey<TFields>) => {
    const own = suffixes.get(key);
    if (!own) {
      throw new Error(`${name} has no field "${key}"`);
    }
    return Object.fromEntries(
      own.map((suffix) => [suffix, tableColumns[`${key}${suffix}`] as PgColumn])
    );
  };

  const toRow = (values: Partial<Record<FieldKey<TFields>, unknown>>) => {
    const row: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(values)) {
      if (value === undefined) {
        continue;
      }
      const field = fields[key] as AnyField | undefined;
      if (!field) {
        throw new Error(`${name} has no field "${key}"`);
      }
      if (isComputedField(field)) {
        throw new Error(`${name}.${key} is computed, so it can't be written`);
      }
      for (const [suffix, column] of Object.entries(field.toColumns(value))) {
        row[`${key}${suffix}`] = column;
      }
    }
    return row;
  };

  const fromRow = (row: Record<string, unknown>) => {
    const record: Record<string, unknown> = {
      id: row.id,
      createdAt: iso(row.createdAt),
      updatedAt: iso(row.updatedAt),
      createdBy: row.createdBy,
      updatedBy: row.updatedBy,
      archivedAt: iso(row.archivedAt ?? null),
      version: row.version,
    };
    for (const key of keys) {
      const field = fields[key] as AnyField;
      if (isComputedField(field)) {
        continue;
      }
      const own = Object.fromEntries(
        (suffixes.get(key) ?? []).map((suffix) => [
          suffix,
          row[`${key}${suffix}`] ?? null,
        ])
      );
      record[key] = field.fromColumns(own);
    }
    for (const key of keys) {
      const field = fields[key] as AnyField;
      if (isComputedField(field)) {
        record[key] = field.evaluate(record);
      }
    }
    if (customFields) {
      record.customFields = row.customFields ?? {};
    }
    return record as ObjectRecord<TFields, TCustomFields>;
  };

  const definition: ObjectDefinition<TName, TFields, TCustomFields> = {
    name,
    label: options.label ?? labelFor(name),
    description: options.description,
    tableName,
    table,
    fields,
    fieldLabels,
    customFields,
    list,
    owner: options.owner,
    actions,
    schemas,
    columnsOf,
    toRow,
    fromRow,
  };
  registerObject(definition as unknown as AnyObjectDefinition);
  return definition;
};
