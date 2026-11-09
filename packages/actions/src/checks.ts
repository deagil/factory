// Ready-made checks (P2.15, decision 0045): internal actions a workflow step
// runs to stop a run that shouldn't go on, each failing with an error code
// of its own. A check that reads a record returns it, so later steps can
// use what it read.
//
// - record_belongs_to_caller: the record's owner field is the person who
//   called (for an agent, the person it acts for).
// - within_limit: a number is within a minimum and a maximum.
// - record_in_state: a field equals a value, or is one of several. After a
//   pause, a later segment re-checks what it relies on with it (decision
//   0046).

import { isDeepStrictEqual } from "node:util";

import type { AnyObjectDefinition } from "@workspace/objects";
import { z } from "zod";

import { defineAction } from "./define-action.ts";
import type { ActionContext, AnyActionDefinition } from "./define-action.ts";
import { isActionFailure } from "./errors.ts";

type Row = Record<string, unknown>;

const shown = (value: unknown) =>
  value === null || value === undefined ? "empty" : JSON.stringify(value);

/** A z.enum of `names`, or any string when there are none. */
const oneOf = (names: string[]) =>
  names.length > 0 ? z.enum(names as [string, ...string[]]) : z.string();

/**
 * The three ready-made checks over `objects`. They name the object in
 * their input, so one action serves every object.
 */
export const checkActions = (
  objects: readonly AnyObjectDefinition[]
): AnyActionDefinition[] => {
  const byName = new Map(objects.map((object) => [object.name, object]));
  const objectOf = (name: string) => byName.get(name) as AnyObjectDefinition;
  const owned = objects.filter((object) => object.owner);
  const record = z.object({ record: z.record(z.string(), z.unknown()) });

  /** The record, archived or not, or a not-found failure. */
  const load = async (
    ctx: Pick<ActionContext, "dal" | "notFound">,
    name: string,
    id: string
  ) => {
    const found = await ctx.dal.get(objectOf(name), id, {
      archived: "include",
    });
    return found ? (found.record as Row) : ctx.notFound(name, id);
  };

  const belongsToCaller = defineAction({
    name: "record_belongs_to_caller",
    kind: "internal",
    description:
      "Check that a record's owner is the person who called the workflow (for an agent, the person it acts for). Returns the record.",
    input: z.strictObject({
      object: oneOf(owned.map((object) => object.name)),
      id: z.uuid(),
    }),
    output: record,
    errors: { not_yours: "This record isn't yours." },
    handler: async (ctx, { object, id }) => {
      const found = await load(ctx, object, id);
      if (isActionFailure(found)) {
        return found;
      }
      const field = objectOf(object).owner as string;
      const caller = ctx.originUserId
        ? await ctx.identity.staffActorOf(ctx.originUserId)
        : undefined;
      if (!caller || found[field] !== caller.id) {
        return ctx.fail(
          "not_yours",
          `This ${objectOf(object).label.toLowerCase()} (${id}) isn't yours.`
        );
      }
      return { record: found };
    },
  });

  const withinLimit = defineAction({
    name: "within_limit",
    kind: "internal",
    description:
      "Check that a number is at least `min` and at most `max`. Give either or both.",
    input: z
      .strictObject({
        value: z.number(),
        min: z.number().optional(),
        max: z.number().optional(),
      })
      .refine((input) => input.min !== undefined || input.max !== undefined, {
        message: "Give a min, a max or both.",
      }),
    output: z.object({ value: z.number() }),
    errors: {
      over_limit: "The value is over the limit.",
      under_limit: "The value is under the limit.",
    },
    handler: (ctx, { value, min, max }) => {
      if (max !== undefined && value > max) {
        return ctx.fail("over_limit", `${value} is over the limit of ${max}.`);
      }
      if (min !== undefined && value < min) {
        return ctx.fail(
          "under_limit",
          `${value} is under the limit of ${min}.`
        );
      }
      return { value };
    },
  });

  const inState = defineAction({
    name: "record_in_state",
    kind: "internal",
    description:
      "Check that a record's field equals `is`, or is one of `one_of`. Give one of them. Returns the record.",
    input: z
      .strictObject({
        object: oneOf([...byName.keys()]),
        id: z.uuid(),
        field: z.string().min(1),
        is: z.json().optional(),
        one_of: z.array(z.json()).min(1).optional(),
      })
      .refine((input) => (input.is === undefined) !== !input.one_of, {
        message: "Give is or one_of, not both.",
      }),
    output: record,
    errors: { wrong_state: "The record isn't in the expected state." },
    handler: async (ctx, { object, id, field, is, one_of: oneOfValues }) => {
      const definition = objectOf(object);
      if (!Object.hasOwn(definition.fields, field)) {
        return ctx.invalid(`${object} has no field "${field}".`, [
          { path: ["field"], message: `Not a field of ${object}` },
        ]);
      }
      const found = await load(ctx, object, id);
      if (isActionFailure(found)) {
        return found;
      }
      const expected = oneOfValues ?? [is];
      const actual = found[field] ?? null;
      if (!expected.some((value) => isDeepStrictEqual(value, actual))) {
        const label = definition.fieldLabels[field] ?? field;
        return ctx.fail(
          "wrong_state",
          `${label} is ${shown(actual)}, not ${expected.map(shown).join(" or ")}.`
        );
      }
      return { record: found };
    },
  });

  return [belongsToCaller, withinLimit, inState];
};
