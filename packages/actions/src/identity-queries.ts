// The identity queries (P1b.04): `actor.list`, `actor.get`, `apiKey.list`
// and `role.list`. The first three need a permission on their own name;
// without it, anyone can still read their own actors (their staff actor and
// their agents) and those actors' keys. `role.list` needs its permission.
import { z } from "zod";

import { defineQuery } from "./define-action.ts";
import type { AnyDefinition, QueryContext } from "./define-action.ts";
import {
  actorDetailSchema,
  actorEntrySchema,
  actorKind,
  actorStatus,
  apiKeyEntrySchema,
} from "./identity-schemas.ts";
import { roleSchema } from "./permissions.ts";
import type { Granted } from "./permissions.ts";

/** Whether the caller holds the permission named `name`. */
const holds = (granted: Granted, name: string) =>
  granted.authorise({
    kind: "query",
    name,
    everyone: false,
  } as unknown as AnyDefinition) === null;

/** Whether `actorId` is the caller's own staff actor or one of its agents. */
const isOwn = async (ctx: QueryContext, actorId: string) => {
  if (actorId === ctx.actor.id) {
    return true;
  }
  const actor = await ctx.dal.actorDetail(actorId);
  return Boolean(
    actor?.user && ctx.actor.userId && actor.user.id === ctx.actor.userId
  );
};

export const actorList = defineQuery({
  name: "actor.list",
  description:
    "Actors, newest first: people (staff), agents, integrations and automations, with their roles. Without the actor.list permission, only your own staff actor and agents.",
  input: z.strictObject({
    kind: actorKind.optional(),
    status: actorStatus.optional(),
    cursor: z.string().optional(),
    limit: z.number().int().min(1).max(200).optional(),
  }),
  output: z.object({
    entries: z.array(actorEntrySchema),
    nextCursor: z.string().nullable(),
  }),
  // Open to everyone; the handler narrows to the caller's own actors.
  everyone: true,
  handler: (ctx, { cursor, limit, ...filter }) => {
    if (holds(ctx.granted, "actor.list")) {
      return ctx.dal.actorList(filter, { cursor, limit });
    }
    // Integrations and automations belong to no one.
    if (!ctx.actor.userId) {
      return { entries: [], nextCursor: null };
    }
    return ctx.dal.actorList(
      { ...filter, userId: ctx.actor.userId },
      { cursor, limit }
    );
  },
});

export const actorGet = defineQuery({
  name: "actor.get",
  description:
    "One actor with its user, roles and API keys (never the keys themselves). Without the actor.get permission, only your own.",
  input: z.strictObject({ id: z.uuid() }),
  output: z.object({ actor: actorDetailSchema }),
  everyone: true,
  handler: async (ctx, { id }) => {
    const actor = await ctx.dal.actorDetail(id);
    if (!actor) {
      return ctx.notFound("actor", id);
    }
    if (!(holds(ctx.granted, "actor.get") || (await isOwn(ctx, id)))) {
      return ctx.forbidden("actor.get");
    }
    return { actor };
  },
});

export const apiKeyList = defineQuery({
  name: "apiKey.list",
  description:
    "An agent's or integration's API keys, newest first: label, when made, last used and revoked. Never the key or its hash. Without the apiKey.list permission, only your own agents' keys.",
  input: z.strictObject({ actorId: z.uuid() }),
  output: z.object({ keys: z.array(apiKeyEntrySchema) }),
  everyone: true,
  handler: async (ctx, { actorId }) => {
    if (!(holds(ctx.granted, "apiKey.list") || (await isOwn(ctx, actorId)))) {
      return ctx.forbidden("apiKey.list");
    }
    return { keys: await ctx.dal.apiKeyList(actorId) };
  },
});

export const roleList = defineQuery({
  name: "role.list",
  description:
    "Every role in the system's config, with its permissions: which objects it can view, create, update or archive, and which actions it can run.",
  input: z.strictObject({}),
  output: z.object({ roles: z.array(roleSchema) }),
  handler: (ctx) => ({ roles: [...ctx.config.roles] }),
});

/** Every identity query, for defineSystem to register. */
export const identityQueries = [
  actorList,
  actorGet,
  apiKeyList,
  roleList,
] as const;
