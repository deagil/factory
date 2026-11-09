// Generated actions and queries: every object gets `<object>_create`,
// `_update`, `_archive` and `_restore` actions and `_get`, `_list` and
// `_history` queries, built from its definition, and the REST endpoints
// that run them (`objectEndpoints`). They emit `<object>_created`,
// `_updated`, `_archived` and `_restored`.
// See docs/SYSTEM_DESIGN.md section 4.2 and decisions 0022, 0045 and 0047.

import { listInputSchema, refKeysOf } from "@workspace/objects";
import type { AnyObjectDefinition } from "@workspace/objects";
import { z } from "zod";

import { defineAction, defineQuery } from "./define-action.ts";
import type {
  AnyActionDefinition,
  AnyDefinition,
  AnyQueryDefinition,
  ObjectSchema,
  ObjectVerb,
} from "./define-action.ts";
import { historyEntrySchema } from "./history.ts";

const changes = z.record(z.string(), z.unknown());
const related = z.record(z.string(), z.record(z.string(), z.unknown()));
const customFieldsInput = z.record(z.string(), z.json());

/** The schemas an object's generated definitions share. */
const schemasOf = (object: AnyObjectDefinition) => {
  const { record } = object.schemas;
  const custom = object.customFields
    ? { customFields: customFieldsInput.optional() }
    : {};
  return {
    record,
    output: z.object({ record }),
    create: (object.schemas.create as ObjectSchema).extend(custom),
    update: (object.schemas.update as ObjectSchema).extend({
      ...custom,
      id: z.uuid(),
      /** Fail with a conflict unless the record is at this version. */
      version: z.int().min(1).optional(),
    }),
    byId: z.strictObject({ id: z.uuid() }),
  };
};

const createAction = (object: AnyObjectDefinition) => {
  const schemas = schemasOf(object);
  return defineAction({
    name: `${object.name}_create`,
    description: `Create a ${object.label.toLowerCase()}`,
    input: schemas.create,
    output: schemas.output,
    emits: { [`${object.name}_created`]: schemas.output },
    handler: async (ctx, input) => {
      const record = await ctx.repo.create(object, input);
      ctx.emit(`${object.name}_created`, { record });
      return { record };
    },
  });
};

const updateAction = (object: AnyObjectDefinition) => {
  const schemas = schemasOf(object);
  const updated = z.object({
    record: schemas.record,
    before: changes,
    after: changes,
  });
  return defineAction({
    name: `${object.name}_update`,
    description: `Change fields on a ${object.label.toLowerCase()}`,
    input: schemas.update,
    output: schemas.output,
    emits: { [`${object.name}_updated`]: updated },
    handler: async (ctx, input) => {
      // The object's own shape is loose here, so name the generated keys.
      const { id, version, ...values } = input as Record<string, unknown> & {
        id: string;
        version?: number;
      };
      const result = await ctx.repo.update(object, id, values, {
        expectedVersion: version,
      });
      switch (result.status) {
        case "not_found": {
          return ctx.notFound(object.name, id);
        }
        case "archived": {
          return ctx.conflict(
            `This ${object.label.toLowerCase()} is archived, so it can't be changed`
          );
        }
        case "conflict": {
          return ctx.conflict(
            `This ${object.label.toLowerCase()} changed since you read it. Read it again and retry.`
          );
        }
        case "updated": {
          const { record, before, after } = result;
          ctx.emit(`${object.name}_updated`, { record, before, after });
          return { record };
        }
        default: {
          return { record: result.record };
        }
      }
    },
  });
};

const archiveAction = (object: AnyObjectDefinition) => {
  const schemas = schemasOf(object);
  return defineAction({
    name: `${object.name}_archive`,
    description: `Archive a ${object.label.toLowerCase()}. Archived records are hidden, not deleted.`,
    input: schemas.byId,
    output: schemas.output,
    emits: { [`${object.name}_archived`]: schemas.output },
    handler: async (ctx, { id }) => {
      const result = await ctx.repo.archive(object, id);
      if (result.status === "not_found") {
        return ctx.notFound(object.name, id);
      }
      if (result.status === "conflict") {
        return ctx.conflict(
          `This ${object.label.toLowerCase()} changed while it was being archived. Retry.`
        );
      }
      if (result.status === "archived") {
        ctx.emit(`${object.name}_archived`, { record: result.record });
      }
      return { record: result.record };
    },
  });
};

/** Undoes `.archive`; it comes with it and needs the same permission. */
const restoreAction = (object: AnyObjectDefinition) => {
  const schemas = schemasOf(object);
  return defineAction({
    name: `${object.name}_restore`,
    description: `Restore an archived ${object.label.toLowerCase()}, so it shows in lists again.`,
    input: schemas.byId,
    output: schemas.output,
    emits: { [`${object.name}_restored`]: schemas.output },
    handler: async (ctx, { id }) => {
      const result = await ctx.repo.restore(object, id);
      if (result.status === "not_found") {
        return ctx.notFound(object.name, id);
      }
      if (result.status === "conflict") {
        return ctx.conflict(
          `This ${object.label.toLowerCase()} changed while it was being restored. Retry.`
        );
      }
      if (result.status === "restored") {
        ctx.emit(`${object.name}_restored`, { record: result.record });
      }
      return { record: result.record };
    },
  });
};

const getQuery = (object: AnyObjectDefinition) => {
  const schemas = schemasOf(object);
  const refs = refKeysOf(object);
  return defineQuery({
    name: `${object.name}_get`,
    description: `One ${object.label.toLowerCase()} by id`,
    input: z.strictObject({
      id: z.uuid(),
      archived: z.enum(["exclude", "include"]).optional(),
      expand:
        refs.length > 0
          ? z.array(z.enum(refs as [string, ...string[]])).optional()
          : z.array(z.never()).max(0).optional(),
    }),
    output: z.object({ record: schemas.record, related }),
    handler: async (ctx, { id, ...options }) => {
      const found = await ctx.dal.get(object, id, options);
      return found ?? ctx.notFound(object.name, id);
    },
  });
};

const listQuery = (object: AnyObjectDefinition) => {
  const schemas = schemasOf(object);
  return defineQuery({
    name: `${object.name}_list`,
    description: `A page of ${object.label.toLowerCase()} records, filtered and sorted`,
    input: listInputSchema(object) as unknown as ObjectSchema,
    output: z.object({
      records: z.array(schemas.record),
      nextCursor: z.string().nullable(),
      related,
    }),
    handler: (ctx, input) => ctx.dal.list(object, input),
  });
};

const historyOf = (object: AnyObjectDefinition) =>
  defineQuery({
    name: `${object.name}_history`,
    description: `Every change to one ${object.label.toLowerCase()}, newest first: which fields changed from what to what, in which run, and who made it.`,
    input: z.strictObject({ id: z.uuid() }),
    output: z.object({ entries: z.array(historyEntrySchema) }),
    handler: async (ctx, { id }) => ({
      entries: await ctx.dal.history(object, id),
    }),
  });

/** What an object endpoint does: its generated action or query. */
export type ObjectJob =
  | "list"
  | "get"
  | "create"
  | "update"
  | "archive"
  | "restore"
  | "history";

/**
 * One REST endpoint of an object (decision 0045): its method, its path in
 * OpenAPI form, and the generated action or query it runs, which is also
 * its MCP tool's name.
 */
export interface ObjectEndpoint {
  readonly object: string;
  readonly job: ObjectJob;
  readonly method: "GET" | "POST" | "PATCH";
  /** `/deals` or `/deals/{id}/archive`: the object's table name, plural. */
  readonly path: string;
  /** The definition it runs: `deal_list`. */
  readonly name: string;
}

/**
 * `object`'s endpoints. A job a hand-written action owns has none until
 * workflows replace that action (P2.25).
 */
export const objectEndpoints = (
  object: AnyObjectDefinition
): ObjectEndpoint[] => {
  const base = `/${object.tableName}`;
  const one = `${base}/{id}`;
  const endpoint = (
    job: ObjectJob,
    method: ObjectEndpoint["method"],
    path: string
  ): ObjectEndpoint => ({
    object: object.name,
    job,
    method,
    path,
    name: `${object.name}_${job}`,
  });
  return [
    endpoint("list", "GET", base),
    endpoint("get", "GET", one),
    ...(object.actions.create.generated
      ? [endpoint("create", "POST", base)]
      : []),
    ...(object.actions.update.generated
      ? [endpoint("update", "PATCH", one)]
      : []),
    ...(object.actions.archive.generated
      ? [
          endpoint("archive", "POST", `${one}/archive`),
          endpoint("restore", "POST", `${one}/restore`),
        ]
      : []),
    endpoint("history", "GET", `${one}/history`),
  ];
};

/**
 * The generated actions and queries for `object`. A job switched off, or
 * owned by a hand-written action (`actions: { create: "booking.place" }`),
 * gets no generated action. Read-only fields are already out of
 * `object.schemas.update`.
 */
/** `definition`, marked with the object permission it needs. */
const needs = <TDefinition extends AnyDefinition>(
  definition: TDefinition,
  object: AnyObjectDefinition,
  can: ObjectVerb
): TDefinition =>
  Object.freeze({
    ...definition,
    objectPermission: { object: object.name, can },
  });

export const generateDefinitions = (
  object: AnyObjectDefinition
): AnyDefinition[] => {
  const actions: AnyActionDefinition[] = [];
  if (object.actions.create.generated) {
    actions.push(needs(createAction(object), object, "create"));
  }
  if (object.actions.update.generated) {
    actions.push(needs(updateAction(object), object, "update"));
  }
  if (object.actions.archive.generated) {
    actions.push(
      needs(archiveAction(object), object, "archive"),
      needs(restoreAction(object), object, "archive")
    );
  }
  const queries: AnyQueryDefinition[] = [
    needs(getQuery(object), object, "view"),
    needs(listQuery(object), object, "view"),
    needs(historyOf(object), object, "view"),
  ];
  return [...actions, ...queries];
};
