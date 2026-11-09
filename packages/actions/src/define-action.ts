// defineAction and defineQuery: every change is an action, every read a
// query, each defined once with its name, description, schemas and handler.
// Handlers reach services only through `ctx`. See docs/SYSTEM_DESIGN.md
// section 4.2 and decision 0019.

import type { ApprovalStore, DraftStore, IdentityStore } from "@workspace/db";
import type { actorKinds } from "@workspace/db/schema";
import type {
  AnyChoiceList,
  AnyField,
  ChoiceOptions,
  DataAccess,
  OptionOf,
  Repository,
} from "@workspace/objects";
import type { z } from "zod";

import type { ApprovalRule, SignOff } from "./approval-rules.ts";
import type {
  ActionError,
  ActionFailure,
  DeclaredError,
  ErrorHelpers,
} from "./errors.ts";
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
  /** Every approval rule (P2.09). None when absent. */
  readonly approvals?: readonly ApprovalRule[];
  /** Checks `config/` on disk against its schemas and the running code. */
  readonly validate?: () => ConfigCheck;
  /**
   * Every workflow, in code and in this version's `config/workflows`
   * (P2.18). Those that start when called are endpoints.
   */
  readonly workflows?: readonly WorkflowEntry[];
}

/**
 * A workflow as the surfaces see it (P2.18): enough to describe it, check
 * its input and find who may call it. `definition` is what the runner in
 * `@workspace/workflows` runs; it is opaque here.
 */
export interface WorkflowEntry {
  readonly key: string;
  readonly label: string;
  readonly description: string;
  /** Only workflows that start when called are endpoints. */
  readonly called: boolean;
  /** A `read_only` workflow is `GET /workflows/<key>`; the rest are POST. */
  readonly readOnly: boolean;
  readonly input: z.ZodType;
  /** Its input as object fields, in order, for forms. */
  readonly fields: readonly {
    readonly key: string;
    readonly label: string;
    readonly field: AnyField;
  }[];
  /** Its declared error codes, with their messages. */
  readonly errors: Readonly<Record<string, string>>;
  readonly definition: unknown;
}

/** What running an approved action came to (P2.09). */
export type ResumeResult =
  | { readonly ok: true; readonly output: unknown }
  | {
      readonly ok: false;
      readonly error: ActionError | { code: "internal"; message: string };
    };

/**
 * Approvals, for the approval and draft actions (P2.09): the rows, bound to
 * the run's transaction, and what the pipeline does to a pending action
 * once it's decided.
 */
export interface ApprovalService extends ApprovalStore {
  /**
   * Runs a pending action whose approvals are all approved, as the actor
   * who asked, in this run's transaction. Its action_log row becomes
   * succeeded or failed; a second call finds nothing pending and throws.
   */
  readonly resume: (runId: string) => Promise<ResumeResult>;
  /**
   * Marks a pending action rejected, or withdrawn by whoever asked; it never
   * runs. An action that isn't pending is left alone.
   */
  readonly close: (
    runId: string,
    status?: "rejected" | "withdrawn"
  ) => Promise<void>;
  /**
   * Parks this same call, by the same actor, as a pending action that runs
   * once approved, and returns its id. For an action that asks for
   * approvals on another subject itself, as `draft.publish` does (decision
   * 0044); approvals on the pending action itself come from the pipeline.
   */
  readonly park: () => Promise<string>;
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
  /** Deletes `branch` from the remote, as discarding a draft does; gone is fine. */
  readonly remove: (branch: string) => Promise<void>;
  /** Every config file at `ref`, with its content (P2.10). */
  readonly files: (
    ref: string
  ) => Promise<{ readonly path: string; readonly content: string }[]>;
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

/**
 * What an object endpoint does (decision 0045): the job of its generated
 * action or query, and what a role grants on the object.
 */
export const objectJobs = [
  "list",
  "get",
  "create",
  "update",
  "archive",
  "restore",
  "history",
] as const;
export type ObjectJob = (typeof objectJobs)[number];

/**
 * The object endpoint a generated definition is. Hand-written ones have
 * none, and a role grants them by name, as it will workflows.
 */
export interface ObjectPermission {
  object: string;
  job: ObjectJob;
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
  /**
   * The sign-offs the approval rules would ask of this actor for running
   * `action` with `input` now, reading a rule's record as the pipeline does
   * (decision 0044). Absent outside the pipeline.
   */
  readonly signOffs?: (action: string, input: unknown) => Promise<SignOff[]>;
}

/**
 * The two kinds of action (decision 0045). An internal one touches only our
 * own database, so a rollback undoes it; it gets the segment's repository.
 * An external one reaches another system, which a rollback can't undo; it
 * runs outside the transaction, with a retry key.
 */
export const actionKinds = ["internal", "external"] as const;
export type ActionKind = (typeof actionKinds)[number];

/** An action's own error codes, each with its plain-English message. */
export type ErrorMessages = Record<string, string>;

/** No declared errors: `fail` takes nothing. */
export type NoErrors = Record<never, never>;

/** Fails with one of the action's declared codes, with its message or `message`. */
export type Fail<TErrors extends ErrorMessages> = (
  code: keyof TErrors & string,
  message?: string
) => ActionFailure<DeclaredError>;

/** What an action handler gets: a query's context, plus writes and events. */
export interface ActionContext<
  TEmits extends EventSchemas = EventSchemas,
  TErrors extends ErrorMessages = ErrorMessages,
> extends QueryContext {
  readonly repo: Repository;
  /** Actors and API keys, for the core's identity actions. */
  readonly identity: IdentityStore;
  /** Draft rows, for the core's draft actions (P2.08). */
  readonly drafts: DraftStore;
  /** Approvals, for the approval and draft actions (P2.09). */
  readonly approvals: ApprovalService;
  /**
   * Whether this run is a dry run, which is rolled back at the end. Actions
   * whose effects are outside the database check it and don't make them.
   */
  readonly dryRun: boolean;
  readonly emit: Emit<TEmits>;
  /**
   * What holding `roles` would give beyond what the caller holds, or null
   * when it gives nothing more: the privilege ceiling (P2.14). Nobody
   * grants, mints or revokes authority they don't hold.
   */
  readonly grantsBeyond: (roles: readonly string[]) => string | null;
  /** Fails with one of the action's declared `errors`. */
  readonly fail: Fail<TErrors>;
}

/**
 * What an external action's handler gets: no repository and no reads, since
 * it runs outside the segment's transaction, but the step's retry key to
 * send so a retried step acts once (decision 0046).
 */
export interface ExternalContext<
  TErrors extends ErrorMessages = ErrorMessages,
> extends ErrorHelpers {
  /** The run id and the step id: the same on every attempt of this step. */
  readonly retryKey: string;
  readonly config: ConfigService;
  readonly clock: Clock;
  readonly actor: Actor;
  readonly originUserId: string | null;
  /** In a dry run or an example case, reach nothing: return what would happen. */
  readonly dryRun: boolean;
  readonly fail: Fail<TErrors>;
}

/** The context an action of `TKind` gets. */
export type ContextFor<
  TKind extends ActionKind,
  TEmits extends EventSchemas,
  TErrors extends ErrorMessages,
> = TKind extends "external"
  ? ExternalContext<TErrors>
  : ActionContext<TEmits, TErrors>;

/** Inputs and outputs are objects, so every surface can carry them as JSON. */
export type ObjectSchema = z.ZodObject;

/** What a handler returns, now or as a promise: the output, or a typed error. */
export type HandlerResult<TOutput extends ObjectSchema> =
  | z.input<TOutput>
  | ActionFailure<ActionError | DeclaredError>;

export interface ActionOptions<
  TName extends string,
  TInput extends ObjectSchema,
  TOutput extends ObjectSchema,
  TEmits extends EventSchemas,
  TErrors extends ErrorMessages = NoErrors,
  TKind extends ActionKind = ActionKind,
> {
  /** snake_case, such as `deal_update`; phase 1's `deal.moveStage` until P2.26. */
  name: TName;
  /** `internal` (our database only) or `external` (another system). */
  kind: TKind;
  /** What it does, for people and agents. Surfaces show it. */
  description: string;
  input: TInput;
  output: TOutput;
  /** The events it may emit, past tense, such as `deal.stageChanged`. */
  emits?: TEmits;
  /**
   * Its own error codes and their messages, such as
   * `{ not_yours: "This record isn't yours." }`, for `ctx.fail`.
   */
  errors?: TErrors;
  /**
   * Output keys whose values are secrets, such as a new API key. The caller
   * gets them once; action_log stores "[redacted]".
   */
  redact?: readonly string[];
  /**
   * Open to every actor: the pipeline doesn't check a permission, so the
   * handler must, such as `approval.approve` checking the approver's role.
   */
  everyone?: boolean;
  /**
   * It only reads, so a `read_only` workflow may run it, and a run that has
   * done nothing else has nothing to undo (P2.16).
   */
  readOnly?: boolean;
  /**
   * Inputs a workflow file must set with a fixed `value`, never `from`
   * data, such as `http_send`'s `url` (AGENTS.md rule 14).
   */
  fixedInputs?: readonly string[];
  handler: (
    ctx: ContextFor<TKind, TEmits, TErrors>,
    input: z.output<TInput>
  ) => HandlerResult<TOutput> | Promise<HandlerResult<TOutput>>;
}

export interface QueryOptions<
  TName extends string,
  TInput extends ObjectSchema,
  TOutput extends ObjectSchema,
> {
  /** `<object>.<verb>`, such as `contact_list`. */
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

export type ActionDefinition<
  TName extends string = string,
  TInput extends ObjectSchema = ObjectSchema,
  TOutput extends ObjectSchema = ObjectSchema,
  TEmits extends EventSchemas = EventSchemas,
  TErrors extends ErrorMessages = ErrorMessages,
  TKind extends ActionKind = ActionKind,
> = Readonly<
  Required<ActionOptions<TName, TInput, TOutput, TEmits, TErrors, TKind>>
>;

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
  readonly kind: ActionKind;
  readonly name: string;
  readonly description: string;
  readonly input: ObjectSchema;
  readonly output: ObjectSchema;
  readonly emits: EventSchemas;
  readonly errors: Readonly<ErrorMessages>;
  readonly redact: readonly string[];
  readonly everyone?: boolean;
  readonly readOnly: boolean;
  readonly fixedInputs: readonly string[];
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

/**
 * Action, query and event names: snake_case (`deal_create`, decision 0047),
 * or phase 1's `<object>.<verb>` in camelCase (`deal.moveStage`), which
 * hand-written definitions keep until workflows replace them (P2.24, P2.25).
 */
export const namePattern =
  /^(?:[a-z][a-z0-9]*(?:_[a-z0-9]+)*|[a-z][a-zA-Z0-9]*\.[a-z][a-zA-Z0-9]*)$/u;

/** Codes the core's own errors use, which an action can't declare, and their helpers. */
const builtInCodes: Record<string, string> = {
  validation: "ctx.invalid",
  permission: "ctx.forbidden",
  approval_required: "ctx.needsApproval",
  conflict: "ctx.conflict",
  not_found: "ctx.notFound",
  internal: "a thrown error",
};

/** `defineAction("deal_update")`, for messages. */
const labelOf = (kind: string, name: string) => `${kind}("${name}")`;

const checkErrors = (name: string, errors: ErrorMessages) => {
  const label = labelOf("defineAction", name);
  for (const [code, message] of Object.entries(errors)) {
    if (!/^[a-z][a-z0-9]*(?:_[a-z0-9]+)*$/u.test(code)) {
      throw new Error(
        `${label}: the error "${code}" must be snake_case, such as "reason_required"`
      );
    }
    if (Object.hasOwn(builtInCodes, code)) {
      throw new Error(
        `${label}: "${code}" is a built-in error; use ${builtInCodes[code]} instead`
      );
    }
    if (message.trim() === "") {
      throw new Error(
        `${label}: the error "${code}" needs a message people can read`
      );
    }
  }
};

const check = (
  kind: "defineAction" | "defineQuery",
  options: { name: string; description: string; emits?: EventSchemas }
) => {
  const { name, description } = options;
  if (!namePattern.test(name)) {
    throw new Error(
      `${kind}("${name}"): the name must be snake_case, such as "deal_move_stage"`
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
        `${kind}("${name}"): the event "${type}" must be snake_case in the past tense, such as "deal_stage_changed"`
      );
    }
  }
};

/**
 * Defines an action: typed code a workflow step runs, internal or external
 * (decision 0045). The only way to change data (AGENTS.md rule 1).
 */
export const defineAction = <
  const TName extends string,
  TInput extends ObjectSchema,
  TOutput extends ObjectSchema,
  TEmits extends EventSchemas = NoEvents,
  const TErrors extends ErrorMessages = NoErrors,
  const TKind extends ActionKind = ActionKind,
>(
  options: ActionOptions<TName, TInput, TOutput, TEmits, TErrors, TKind>
): ActionDefinition<TName, TInput, TOutput, TEmits, TErrors, TKind> => {
  check("defineAction", options);
  checkErrors(options.name, options.errors ?? {});
  if (
    options.kind === "external" &&
    Object.keys(options.emits ?? {}).length > 0
  ) {
    throw new Error(
      `${labelOf("defineAction", options.name)}: an external action can't emit events; a workflow's emit step does that`
    );
  }
  for (const key of options.fixedInputs ?? []) {
    if (!Object.hasOwn(options.input.shape, key)) {
      throw new Error(
        `${labelOf("defineAction", options.name)}: the fixed input "${key}" isn't in its input`
      );
    }
  }
  if (options.readOnly && Object.keys(options.emits ?? {}).length > 0) {
    throw new Error(
      `${labelOf("defineAction", options.name)}: a read-only action can't emit events`
    );
  }
  return Object.freeze({
    kind: options.kind,
    name: options.name,
    description: options.description,
    input: options.input,
    output: options.output,
    emits: Object.freeze({ ...options.emits }) as TEmits,
    errors: Object.freeze({ ...options.errors }) as TErrors,
    redact: Object.freeze([...(options.redact ?? [])]),
    everyone: options.everyone ?? false,
    readOnly: options.readOnly ?? false,
    fixedInputs: Object.freeze([...(options.fixedInputs ?? [])]),
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
