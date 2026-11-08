// defineAction and defineQuery: every change is an action, every read a
// query, each defined once with its name, description, schemas and handler.
// Handlers reach services only through `ctx`. See docs/SYSTEM_DESIGN.md
// section 4.2 and decision 0019.

import type { DraftStore, IdentityStore } from "@workspace/db";
import type { actorKinds } from "@workspace/db/schema";
import type {
  AnyChoiceList,
  ChoiceOptions,
  DataAccess,
  OptionOf,
  Repository,
} from "@workspace/objects";
import type { z } from "zod";

import type { ActionFailure, ErrorHelpers } from "./errors.ts";
import type { Granted, Role } from "./permissions.ts";

/** Time, from the context, so tests and dry runs control it. */
export interface Clock {
  now: () => Date;
}

/** One problem `validate` found, at a place in a config file. */
export interface ConfigCheckProblem {
  readonly file: string;
  readonly path: readonly (string | number)[];
  readonly line: number | null;
  readonly message: string;
}

/** What `ConfigService.validate` found in `config/` as it is on disk. */
export interface ConfigCheck {
  readonly files: number;
  readonly problems: readonly ConfigCheckProblem[];
}

/**
 * Config, as actions see it: the version the config loader has live
 * (P2.05). Tests pass a static one, with `sha` null.
 */
export interface ConfigService {
  /** The config version this run uses, written to action_log.config_sha. */
  readonly sha: string | null;
  /** Every role, by key. */
  readonly roles: readonly Role[];
  /** The options of each choice list, by list key (P2.06). */
  readonly choices?: ChoiceOptions;
  /**
   * One choice list as this run sees it (P2.07), with its columns typed. The
   * pipeline adds it from `choices` when a run starts, so `get` reads the
   * pinned version.
   */
  readonly choice?: <TList extends AnyChoiceList>(
    list: TList
  ) => ChoiceListAccess<OptionOf<TList>>;
  /** Checks `config/` on disk against its schemas and the running code. */
  readonly validate?: () => ConfigCheck;
}

/** One choice list: `get` returns the option that can be chosen now. */
export interface ChoiceListAccess<TOption> {
  /**
   * The option with `key`, when it exists and isn't archived. An archived
   * option stays valid on a record that already has it, but can't be chosen.
   */
  readonly get: (key: string) => TOption | undefined;
}

/** `ctx.config.choice(list)`, from the options pinned for a run. */
export const choiceList = <TList extends AnyChoiceList>(
  choices: ChoiceOptions | undefined,
  list: TList
): ChoiceListAccess<OptionOf<TList>> => ({
  get: (key) =>
    choices?.(list.key)?.find(
      (option) => option.key === key && option.archived !== true
    ) as OptionOf<TList> | undefined,
});

/** One config file before and after a change; null where it doesn't exist. */
export interface ConfigFileDiff {
  readonly path: string;
  readonly before: string | null;
  readonly after: string | null;
}

/** Who a config commit is by. */
export interface ConfigAuthor {
  readonly name: string;
  readonly email: string;
}

/** What publishing a draft did. */
export type PublishResult =
  | {
      readonly status: "published";
      /** The one commit on production. */
      readonly sha: string;
      /** The same changes copied to main, or the files that stopped it. */
      readonly synced:
        | { readonly status: "copied"; readonly sha: string }
        | { readonly status: "conflict"; readonly files: readonly string[] };
    }
  /** Production changed these files since the draft began. */
  | { readonly status: "conflict"; readonly files: readonly string[] }
  /** The draft on top of production doesn't validate. */
  | { readonly status: "invalid"; readonly problems: ConfigCheck["problems"] };

/**
 * The config remote (P2.08, SYSTEM_DESIGN §4.4): drafts are branches made
 * from production, one commit per saved file, and publishing writes them to
 * production in one commit, then copies that to main. Plain git, any remote.
 */
export interface GitService {
  /** The branch staff publish to and the instance runs. */
  readonly production: string;
  /** The commit `branch` is at. */
  readonly head: (branch: string) => Promise<string>;
  /** Makes `name` from production's head; returns that commit. */
  readonly branch: (name: string) => Promise<string>;
  /** Writes one file (or deletes it, with null) on `branch` as one commit. */
  readonly commit: (input: {
    branch: string;
    path: string;
    content: string | null;
    message: string;
    author: ConfigAuthor;
  }) => Promise<{ status: "committed"; sha: string } | { status: "conflict" }>;
  /** The config files that differ between two commits, with both versions. */
  readonly diff: (from: string, to: string) => Promise<ConfigFileDiff[]>;
  /** Checks the config at `ref` against the running code. */
  readonly check: (ref: string) => Promise<ConfigCheck>;
  /** Writes the draft on `branch` to production in one commit, then to main. */
  readonly publish: (input: {
    branch: string;
    base: string;
    message: string;
    author: ConfigAuthor;
  }) => Promise<PublishResult>;
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
  /** What the actor may do, for handlers that filter by it. */
  readonly granted: Granted;
  readonly config: ConfigService;
  /**
   * The config remote, for drafts (P2.08). Absent when the system reads
   * `config/` from its working tree, as it does locally.
   */
  readonly git: GitService | undefined;
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
  /** Draft rows, for the core's draft actions (P2.08). */
  readonly drafts: DraftStore;
  /**
   * Whether this run is a dry run, which is rolled back at the end. Actions
   * whose effects are outside the database check it and don't make them.
   */
  readonly dryRun: boolean;
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
  /**
   * Any caller may run it, with no permission. Only for queries that filter
   * their result by `ctx.granted` themselves, such as `system.describe`.
   */
  everyone?: boolean;
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
  readonly everyone?: boolean;
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
    everyone: options.everyone ?? false,
    handler: options.handler,
  });
};
