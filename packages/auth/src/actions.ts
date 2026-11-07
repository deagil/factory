// The core's identity actions: inviting people, making agent and
// integration actors, setting roles, disabling and enabling actors, and
// creating and revoking API keys. Like every change, they run through the
// pipeline, so they're permission-checked and logged (decisions 0025, 0034).

import { defineAction } from "@workspace/actions";
import type { ActionContext } from "@workspace/actions";
import { z } from "zod";

const actorOutput = z.object({ actorId: z.uuid() });

/** An agent that acts for the caller, never with more than they have. */
export const createAgent = defineAction({
  name: "actor.createAgent",
  description:
    "Create an agent actor that acts for you, such as Claude Code over MCP. It can never do more than you can.",
  input: z.strictObject({
    name: z.string().min(1).max(200),
    /** Roles that narrow the agent further. None means everything you can do. */
    roles: z.array(z.string()).optional(),
  }),
  output: actorOutput,
  handler: async (ctx, { name, roles }) => {
    if (ctx.actor.kind !== "staff" || !ctx.actor.userId) {
      return ctx.forbidden(
        "actor.createAgent",
        "Only a signed-in person can create an agent to act for them"
      );
    }
    const agent = await ctx.identity.createActor({
      kind: "agent",
      name,
      userId: ctx.actor.userId,
    });
    await ctx.identity.grantRoles(agent.id, roles ?? []);
    return { actorId: agent.id };
  },
});

/** An external system, limited to the roles it's given. */
export const createIntegration = defineAction({
  name: "actor.createIntegration",
  description:
    "Create an integration actor for an external system. It can do only what its roles allow.",
  input: z.strictObject({
    name: z.string().min(1).max(200),
    roles: z.array(z.string()).min(1),
  }),
  output: actorOutput,
  handler: async (ctx, { name, roles }) => {
    const integration = await ctx.identity.createActor({
      kind: "integration",
      name,
    });
    await ctx.identity.grantRoles(integration.id, roles);
    return { actorId: integration.id };
  },
});

/** A key for an agent or integration. The key is shown once. */
export const createApiKey = defineAction({
  name: "apiKey.create",
  description:
    "Create an API key for an agent or integration. The key is returned once and never stored.",
  input: z.strictObject({
    actorId: z.uuid(),
    label: z.string().min(1).max(200),
  }),
  output: z.object({ id: z.uuid(), key: z.string() }),
  redact: ["key"],
  handler: async (ctx, { actorId, label }) => {
    const actor = await ctx.identity.getActor(actorId);
    if (!actor) {
      return ctx.notFound("actor", actorId);
    }
    if (actor.kind !== "agent" && actor.kind !== "integration") {
      return ctx.invalid("Only agents and integrations have API keys");
    }
    // A key for an agent acts as its user, so only that user may make one.
    if (actor.kind === "agent" && actor.userId !== ctx.actor.userId) {
      return ctx.forbidden(
        "apiKey.create",
        "Only the person an agent acts for can create its keys"
      );
    }
    return ctx.identity.createApiKey({ actorId, label });
  },
});

export const revokeApiKey = defineAction({
  name: "apiKey.revoke",
  description: "Revoke an API key. It stops working at once.",
  input: z.strictObject({ id: z.uuid() }),
  output: z.object({ id: z.uuid() }),
  handler: async (ctx, { id }) => {
    const key = await ctx.identity.getApiKey(id);
    if (!key) {
      return ctx.notFound("apiKey", id);
    }
    await ctx.identity.revokeApiKey(id, ctx.clock.now());
    return { id };
  },
});

const roleKeys = z.array(z.string().min(1)).max(50);

/** A validation failure for any of `keys` config doesn't define, or null. */
const unknownRoles = (ctx: ActionContext, keys: readonly string[]) => {
  const known = new Set(ctx.config.roles.map((role) => role.key));
  const unknown = keys.filter((key) => !known.has(key));
  return unknown.length === 0
    ? null
    : ctx.invalid(`There is no role ${unknown.join(", ")}`, [
        { path: ["roles"], message: `Unknown roles: ${unknown.join(", ")}` },
      ]);
};

/** A person who will sign in with a code: their user and staff actor. */
export const inviteUser = defineAction({
  name: "user.invite",
  description:
    "Invite a person: makes their user and staff actor with these roles. They sign in with a code sent to their email.",
  input: z.strictObject({
    name: z.string().trim().min(1).max(200),
    email: z.email(),
    roles: roleKeys,
  }),
  output: z.object({ userId: z.uuid(), actorId: z.uuid() }),
  handler: async (ctx, { name, email, roles }) => {
    const refused = unknownRoles(ctx, roles);
    if (refused) {
      return refused;
    }
    const user = await ctx.identity.createUser({ name, email });
    if (!user) {
      return ctx.conflict(`Someone already has the email ${email}`);
    }
    const actor = await ctx.identity.createStaffActor({ id: user.id, name });
    await ctx.identity.grantRoles(actor.id, roles);
    return { userId: user.id, actorId: actor.id };
  },
});

/**
 * Replaces an actor's roles. An agent's must be among its user's: it acts
 * for them and can only narrow what they can do.
 */
export const setRoles = defineAction({
  name: "actor.setRoles",
  description:
    "Replace an actor's roles. An agent's roles must be among its person's, since it can only do less than they can. You can't change your own.",
  input: z.strictObject({ id: z.uuid(), roles: roleKeys }),
  output: z.object({ actorId: z.uuid(), roles: z.array(z.string()) }),
  handler: async (ctx, { id, roles }) => {
    const actor = await ctx.identity.getActor(id);
    if (!actor) {
      return ctx.notFound("actor", id);
    }
    if (actor.id === ctx.actor.id) {
      return ctx.forbidden("actor.setRoles", "You can't change your own roles");
    }
    const refused = unknownRoles(ctx, roles);
    if (refused) {
      return refused;
    }
    if (actor.kind === "agent" && actor.userId) {
      const staff = await ctx.identity.staffActorOf(actor.userId);
      const theirs = new Set(staff ? await ctx.identity.rolesOf(staff.id) : []);
      const beyond = roles.filter((key) => !theirs.has(key));
      if (beyond.length > 0) {
        return ctx.invalid(
          `An agent's roles must be among its person's; they don't have ${beyond.join(", ")}`,
          [
            {
              path: ["roles"],
              message: `Not the person's: ${beyond.join(", ")}`,
            },
          ]
        );
      }
    }
    const unique = [...new Set(roles)].toSorted();
    await ctx.identity.setRoles(id, unique);
    return { actorId: id, roles: unique };
  },
});

const statusOutput = z.object({
  actorId: z.uuid(),
  status: z.enum(["active", "disabled"]),
});

/** Sets an actor's status, and a staff actor's user's with it. */
const setStatus = async (
  ctx: ActionContext,
  id: string,
  status: "active" | "disabled",
  permission: string
) => {
  const actor = await ctx.identity.getActor(id);
  if (!actor) {
    return ctx.notFound("actor", id);
  }
  const yourself =
    actor.id === ctx.actor.id ||
    (actor.kind === "staff" && actor.userId === ctx.actor.userId);
  if (yourself) {
    return ctx.forbidden(permission, "You can't disable or enable yourself");
  }
  await ctx.identity.setActorStatus(id, status);
  if (actor.kind === "staff" && actor.userId) {
    await ctx.identity.setUserStatus(actor.userId, status);
  }
  return { actorId: id, status };
};

export const disableActor = defineAction({
  name: "actor.disable",
  description:
    "Disable an actor: it can't act, and its API keys are refused. Disabling a person's staff actor also stops them signing in and ends their sessions; their agents stop too. You can't disable yourself.",
  input: z.strictObject({ id: z.uuid() }),
  output: statusOutput,
  handler: (ctx, { id }) => setStatus(ctx, id, "disabled", "actor.disable"),
});

export const enableActor = defineAction({
  name: "actor.enable",
  description:
    "Enable a disabled actor again. Enabling a person's staff actor lets them sign in again.",
  input: z.strictObject({ id: z.uuid() }),
  output: statusOutput,
  handler: (ctx, { id }) => setStatus(ctx, id, "active", "actor.enable"),
});

/** Every identity action, for defineSystem to register. */
export const identityActions = [
  inviteUser,
  createAgent,
  createIntegration,
  setRoles,
  disableActor,
  enableActor,
  createApiKey,
  revokeApiKey,
] as const;
