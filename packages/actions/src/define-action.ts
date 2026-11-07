// defineAction and defineQuery: every change is an action, every read a
// query, each defined once with its name, description, schemas and handler.
// Handlers reach services only through `ctx`. See docs/SYSTEM_DESIGN.md
// section 4.2 and decision 0019.

import type { IdentityStore } from "@workspace/db";
import type { actorKinds } from "@workspace/db/schema";
import type { DataAccess, Repository } from "@workspace/objects";
import type { z } from "zod";

import type { ActionFailure, ErrorHelpers } from "./errors.ts";
import type { Role } from "./permissions.ts";

/** Time, from the context, so tests and dry runs control it. */
export interface Clock {
  now: () => Date;
}

/**
 * Config, as actions see it. In phase 1 it's a static object passed to
 * defineSystem, so `sha` is null; phase 2 loads it from git.
 */
export interface ConfigService {
  /** The config commit this run uses, written to action_log.config_sha. */
  readonly sha: string | null;
  /** Every role, by key. */
  readonly roles: readonly Role[];
}

/** What a permission on an object lets an actor do. */
export const objectVerbs = ["view", "create", "update", "archive"] as const;
export type ObjectVerb = (typeof objectVerbs)[number];

/**
 * The object permission a generated definition needs. Hand-written ones
 * have none, and need a permission on their own name instead.
 */
export interface ObjectPermission {
  object: string;
  can: ObjectVerb;
}

/** Who is performing the action or query. */
export interface Actor {
  id: string;
  kind: (typeof actorKinds)[number];
  name: string;
  /** The user a staff or agent actor belongs to; null for the others. */
  userId: string | null;
}

/** An action's events: one payload schema per event type. */
export type EventSchemas = Record<string, z.ZodType>;

/** No events: `emit` takes nothing. */
export type NoEvents = Record<never, never>;

/**
 * Emits one of the action's declared events. Undeclared event types and
 * payloads that don't fit the schema fail type-checking.
 */
export type Emit<TEmits extends EventSchemas> = <
  TType extends keyof TEmits & string,
>(
  type: TType,
  payload: z.input<TEmits[TType]>
) => void;

/** What a query handler gets: reads, config, time, who and the error helpers. */
export interface QueryContext extends ErrorHelpers {
  readonly dal: DataAccess;
  readonly config: ConfigService;
  readonly clock: Clock;
  readonly actor: Actor;
  /** The person at the start of the chain; null if there isn't one. */
  readonly originUserId: string | null;
}

/** What an action handler gets: a query's context, plus writes and events. */
export interface ActionContext<
  TEmits extends EventSchemas = EventSchemas,
> extends QueryContext {
  readonly repo: Repository;
  /** Actors and API keys, for the core's identity actions. */
  readonly identity: IdentityStore;
  readonly emit: Emit<TEmits>;
}

/** Inputs and outputs are objects, so every surface can carry them as JSON. */
export type ObjectSchema = z.ZodObject;

/** What a handler returns, now or as a promise: the output, or a typed error. */
export type HandlerResult<TOutput extends ObjectSchema> =
  | z.input<TOutput>
  | ActionFailure;

export interface ActionOptions<
  TName extends string,
  TInput extends ObjectSchema,
  TOutput extends ObjectSchema,
  TEmits extends EventSchemas,
> {
  /** `<object>.<verb>`, such as `deal.moveStage`. */
  name: TName;
  /** What it does, for people and agents. Surfaces show it. */
  description: string;
  input: TInput;
  output: TOutput;
  /** The events it may emit, past tense, such as `deal.stageChanged`. */
  emits?: TEmits;
  /**
   * Output keys whose values are secrets, such as a new API key. The caller
   * gets them once; action_log stores "[redacted]".
   */
  redact?: readonly string[];
  handler: (
    ctx: ActionContext<TEmits>,
    input: z.output<TInput>
  ) => HandlerResult<TOutput> | Promise<HandlerResult<TOutput>>;
}

export interface QueryOptions<
  TName extends string,
  TInput extends ObjectSchema,
  TOutput extends ObjectSchema,
> {
  /** `<object>.<verb>`, such as `contact.list`. */
  name: TName;
  description: string;
  input: TInput;
  output: TOutput;
  handler: (
    ctx: QueryContext,
    input: z.output<TInput>
  ) => HandlerResult<TOutput> | Promise<HandlerResult<TOutput>>;
}

export interface ActionDefinition<
  TName extends string = string,
  TInput extends ObjectSchema = ObjectSchema,
  TOutput extends ObjectSchema = ObjectSchema,
  TEmits extends EventSchemas = EventSchemas,
> extends Required<ActionOptions<TName, TInput, TOutput, TEmits>> {
  readonly kind: "action";
}

export interface QueryDefinition<
  TName extends string = string,
  TInput extends ObjectSchema = ObjectSchema,
  TOutput extends ObjectSchema = ObjectSchema,
> extends QueryOptions<TName, TInput, TOutput> {
  readonly kind: "query";
}

/* oxlint-disable typescript/no-explicit-any -- the widest definitions: their
   handlers take any context and input, so every definition fits them. */
/** Any action. */
export interface AnyActionDefinition {
  readonly kind: "action";
  readonly name: string;
  readonly description: string;
  readonly input: ObjectSchema;
  readonly output: ObjectSchema;
  readonly emits: EventSchemas;
  readonly redact: readonly string[];
  readonly handler: (ctx: any, input: any) => unknown;
  readonly objectPermission?: ObjectPermission;
}

/** Any query. */
export interface AnyQueryDefinition {
  readonly kind: "query";
  readonly name: string;
  readonly description: string;
  readonly input: ObjectSchema;
  readonly output: ObjectSchema;
  readonly handler: (ctx: any, input: any) => unknown;
  readonly objectPermission?: ObjectPermission;
}
/* oxlint-enable typescript/no-explicit-any */

/** Any action or query: what the registry holds. */
export type AnyDefinition = AnyActionDefinition | AnyQueryDefinition;

/** Action, query and event names: `<object>.<word>`, each part camelCase. */
export const namePattern = /^[a-z][a-zA-Z0-9]*\.[a-z][a-zA-Z0-9]*$/u;

const check = (
  kind: "defineAction" | "defineQuery",
  options: { name: string; description: string; emits?: EventSchemas }
) => {
  const { name, description } = options;
  if (!namePattern.test(name)) {
    throw new Error(
      `${kind}("${name}"): the name must be <object>.<verb> in camelCase, such as "deal.moveStage"`
    );
  }
  if (description.trim() === "") {
    throw new Error(
      `${kind}("${name}"): a description is required. Surfaces and agents show it.`
    );
  }
  for (const type of Object.keys(options.emits ?? {})) {
    if (!namePattern.test(type)) {
      throw new Error(
        `${kind}("${name}"): the event "${type}" must be <object>.<pastTense> in camelCase, such as "deal.stageChanged"`
      );
    }
  }
};

/** Defines an action: the only way to change data (AGENTS.md rule 1). */
export const defineAction = <
  const TName extends string,
  TInput extends ObjectSchema,
  TOutput extends ObjectSchema,
  TEmits extends EventSchemas = NoEvents,
>(
  options: ActionOptions<TName, TInput, TOutput, TEmits>
): ActionDefinition<TName, TInput, TOutput, TEmits> => {
  check("defineAction", options);
  return Object.freeze({
    kind: "action",
    name: options.name,
    description: options.description,
    input: options.input,
    output: options.output,
    emits: Object.freeze({ ...options.emits }) as TEmits,
    redact: Object.freeze([...(options.redact ?? [])]),
    handler: options.handler,
  });
};

/** Defines a query: a read, which can't write or emit. */
export const defineQuery = <
  const TName extends string,
  TInput extends ObjectSchema,
  TOutput extends ObjectSchema,
>(
  options: QueryOptions<TName, TInput, TOutput>
): QueryDefinition<TName, TInput, TOutput> => {
  check("defineQuery", options);
  return Object.freeze({
    kind: "query",
    name: options.name,
    description: options.description,
    input: options.input,
    output: options.output,
    handler: options.handler,
  });
};
