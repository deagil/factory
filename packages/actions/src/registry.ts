// The action registry: every action and query a system has, from which
// every surface is generated (decision 0001). defineSystem (P1.18) builds
// one from the system's own and the generated definitions.

import type { z } from "zod";

import type {
  AnyActionDefinition,
  AnyDefinition,
  AnyQueryDefinition,
} from "./define-action.ts";

/** An event type, with the actions that declare it. */
export interface RegisteredEvent {
  type: string;
  schema: z.ZodType;
  emittedBy: string[];
}

export interface Registry {
  /** Every action and query, in the order they were given. */
  readonly list: () => AnyDefinition[];
  readonly actions: () => AnyActionDefinition[];
  readonly queries: () => AnyQueryDefinition[];
  /** The action or query called `name`, if there is one. */
  readonly get: (name: string) => AnyDefinition | undefined;
  /** Every event type the actions declare, by type. */
  readonly events: () => RegisteredEvent[];
}

/**
 * A registry of `definitions`. Actions and queries share one namespace, so
 * two with the same name fail, whatever their kinds. An event declared by
 * more than one action must use the same schema in each.
 */
export const createRegistry = (
  definitions: readonly AnyDefinition[]
): Registry => {
  const byName = new Map<string, AnyDefinition>();
  const events = new Map<string, RegisteredEvent>();
  for (const definition of definitions) {
    const taken = byName.get(definition.name);
    if (taken) {
      const kinds =
        taken.kind === definition.kind
          ? `two ${definition.kind === "action" ? "actions" : "queries"}`
          : "an action and a query";
      throw new Error(
        `"${definition.name}" is registered twice, as ${kinds}. Names must be unique across actions and queries.`
      );
    }
    byName.set(definition.name, definition);
    if (definition.kind !== "action") {
      continue;
    }
    for (const [type, schema] of Object.entries(definition.emits)) {
      const event = events.get(type);
      if (!event) {
        events.set(type, { type, schema, emittedBy: [definition.name] });
        continue;
      }
      if (event.schema !== schema) {
        throw new Error(
          `The event "${type}" is declared by ${event.emittedBy.join(", ")} and ${definition.name} with different schemas. Declare its schema once and share it.`
        );
      }
      event.emittedBy.push(definition.name);
    }
  }

  const all = [...byName.values()];
  return Object.freeze({
    list: () => [...all],
    actions: () =>
      all.filter((d): d is AnyActionDefinition => d.kind === "action"),
    queries: () =>
      all.filter((d): d is AnyQueryDefinition => d.kind === "query"),
    get: (name: string) => byName.get(name),
    events: () =>
      [...events.values()].map((event) => ({
        ...event,
        emittedBy: [...event.emittedBy],
      })),
  });
};
