// The generated record actions (P2.15, decision 0045): every object gets
// internal `<object>_get`, `_list`, `_create`, `_update`, `_archive` and
// `_restore` actions for workflow steps to run. They run under the service
// key, so no role rule narrows them, and they're never on a surface: the
// object endpoints of the same name are what callers reach. Unlike the
// endpoints, every object has all six, whatever its `actions` option says.

import { listInputSchema, refKeysOf } from "@workspace/objects";
import type { AnyObjectDefinition } from "@workspace/objects";
import { z } from "zod";

import { checkActions } from "./checks.ts";
import { defineAction } from "./define-action.ts";
import type { AnyActionDefinition, ObjectSchema } from "./define-action.ts";
import {
  archiveAction,
  createAction,
  restoreAction,
  updateAction,
} from "./generated.ts";

type Row = Record<string, unknown>;

const related = z.record(z.string(), z.record(z.string(), z.unknown()));

const getAction = (object: AnyObjectDefinition) => {
  const refs = refKeysOf(object);
  return defineAction({
    name: `${object.name}_get`,
    kind: "internal",
    description: `Read one ${object.label.toLowerCase()} by id, archived or not if asked.`,
    input: z.strictObject({
      id: z.uuid(),
      archived: z.enum(["exclude", "include"]).optional(),
      expand:
        refs.length > 0
          ? z.array(z.enum(refs as [string, ...string[]])).optional()
          : z.array(z.never()).max(0).optional(),
    }),
    output: z.object({
      record: object.schemas.record as ObjectSchema,
      related,
    }),
    handler: async (ctx, { id, ...options }) => {
      const found = await ctx.dal.get(object, id, options);
      return found
        ? { record: found.record as Row, related: found.related }
        : ctx.notFound(object.name, id);
    },
  });
};

const listAction = (object: AnyObjectDefinition) =>
  defineAction({
    name: `${object.name}_list`,
    kind: "internal",
    description: `A page of ${object.label.toLowerCase()} records, filtered and sorted.`,
    input: listInputSchema(object) as unknown as ObjectSchema,
    output: z.object({
      records: z.array(object.schemas.record as ObjectSchema),
      nextCursor: z.string().nullable(),
      related,
    }),
    handler: async (ctx, input) => {
      const page = await ctx.dal.list(object, input);
      return { ...page, records: page.records as Row[] };
    },
  });

/** `object`'s six record actions. */
export const recordActions = (
  object: AnyObjectDefinition
): AnyActionDefinition[] => [
  getAction(object),
  listAction(object),
  createAction(object),
  updateAction(object),
  archiveAction(object),
  restoreAction(object),
];

/**
 * Every action a workflow step can run on `objects`: each object's record
 * actions and the ready-made checks. None of them is on a surface.
 */
export const stepActions = (
  objects: readonly AnyObjectDefinition[]
): AnyActionDefinition[] => [
  ...objects.flatMap((object) => recordActions(object)),
  ...checkActions(objects),
];
