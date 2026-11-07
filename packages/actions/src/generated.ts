// Generated actions and queries: every object gets `<object>.create`,
// `.update` and `.archive` actions and `.get` and `.list` queries, built from
// its definition. They emit `<object>.created`, `.updated` and `.archived`.
// See docs/SYSTEM_DESIGN.md section 4.2 and decision 0022.

import { listInputSchema, refKeysOf } from "@workspace/objects";
import type { AnyObjectDefinition } from "@workspace/objects";
import { z } from "zod";

import { defineAction, defineQuery } from "./define-action.ts";
import type {
  AnyActionDefinition,
  AnyDefinition,
  AnyQueryDefinition,
  ObjectSchema,
} from "./define-action.ts";

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
    name: `${object.name}.create`,
    description: `Create a ${object.label.toLowerCase()}`,
    input: schemas.create,
    output: schemas.output,
    emits: { [`${object.name}.created`]: schemas.output },
    handler: async (ctx, input) => {
      const record = await ctx.repo.create(object, input);
      ctx.emit(`${object.name}.created`, { record });
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
    name: `${object.name}.update`,
    description: `Change fields on a ${object.label.toLowerCase()}`,
    input: schemas.update,
    output: schemas.output,
    emits: { [`${object.name}.updated`]: updated },
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
          ctx.emit(`${object.name}.updated`, { record, before, after });
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
    name: `${object.name}.archive`,
    description: `Archive a ${object.label.toLowerCase()}. Archived records are hidden, not deleted.`,
    input: schemas.byId,
    output: schemas.output,
    emits: { [`${object.name}.archived`]: schemas.output },
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
        ctx.emit(`${object.name}.archived`, { record: result.record });
      }
      return { record: result.record };
    },
  });
};

const getQuery = (object: AnyObjectDefinition) => {
  const schemas = schemasOf(object);
  const refs = refKeysOf(object);
  return defineQuery({
    name: `${object.name}.get`,
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
    name: `${object.name}.list`,
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

/**
 * The generated actions and queries for `object`. A job switched off, or
 * owned by a hand-written action (`actions: { create: "booking.place" }`),
 * gets no generated action. Read-only fields are already out of
 * `object.schemas.update`.
 */
export const generateDefinitions = (
  object: AnyObjectDefinition
): AnyDefinition[] => {
  const actions: AnyActionDefinition[] = [];
  if (object.actions.create.generated) {
    actions.push(createAction(object));
  }
  if (object.actions.update.generated) {
    actions.push(updateAction(object));
  }
  if (object.actions.archive.generated) {
    actions.push(archiveAction(object));
  }
  const queries: AnyQueryDefinition[] = [getQuery(object), listQuery(object)];
  return [...actions, ...queries];
};
