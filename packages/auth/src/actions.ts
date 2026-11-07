// The core's identity actions: making agent and integration actors, and
// creating and revoking their API keys. Like every change, they run through
// the pipeline, so they're permission-checked and logged (decision 0025).

import { defineAction } from "@workspace/actions";
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

/** Every identity action, for defineSystem to register. */
export const identityActions = [
  createAgent,
  createIntegration,
  createApiKey,
  revokeApiKey,
] as const;
