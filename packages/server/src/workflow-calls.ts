// Calling a workflow endpoint (P2.18; decisions 0045 and 0046). The caller's
// roles are checked once, here; the workflow then runs under the service key
// with the caller as origin user (AGENTS.md rule 13). Every surface (HTTP,
// MCP, the web app through HTTP) calls through this, so a call writes the
// same run rows whichever one it came from.
import { isDeepStrictEqual } from "node:util";

import { failures, mayCall } from "@workspace/actions";
import type {
  AnyActionDefinition,
  AnyDefinition,
  Caller,
  Clock,
  ConfigService,
  Pipeline,
  RunError as ActionRunError,
  WorkflowEntry,
} from "@workspace/actions";
import { findRetriedRun } from "@workspace/db";
import type { Db } from "@workspace/db";
import { createRunner, definitionOf } from "@workspace/workflows";
import type {
  DurableOptions,
  RunContext,
  RunError,
  WorkflowDefinition,
} from "@workspace/workflows";
import type { z } from "zod";

export type WorkflowCallError = RunError | ActionRunError;

export type WorkflowCallResult =
  | {
      readonly ok: true;
      readonly output: unknown;
      readonly runId: string;
      readonly replayed: boolean;
      /** It paused, is still going, or needs attention (P2.20): no output yet. */
      readonly pending?: "running" | "waiting" | "needs_attention";
    }
  | {
      readonly ok: false;
      readonly error: WorkflowCallError;
      readonly runId: string | null;
    };

export interface WorkflowCallOptions {
  readonly retryKey?: string | undefined;
  /** How it was called over HTTP: only a `read_only` workflow answers GET. */
  readonly method?: "GET" | "POST";
}

export interface WorkflowCallsOptions {
  readonly db: Db;
  readonly pipeline: Pipeline;
  readonly clock: Clock;
  /** What steps run: `System.stepActions`. */
  readonly stepActions: ReadonlyMap<string, AnyActionDefinition>;
  /** The system's actions and queries, for the payloads of their events. */
  readonly definitions: readonly AnyDefinition[];
  /**
   * For workflows that pause or reach other systems (P2.20): the system's
   * name and database, and its live config for runs a restart picks up.
   */
  readonly durable?: {
    readonly name: string;
    readonly databaseUrl: string;
    readonly config: () => ConfigService;
    readonly retries?: DurableOptions["retries"];
    readonly waitMs?: number;
  };
}

/** The workflows `config` has that `granted` may call, which are endpoints. */
export const callableWorkflows = (
  config: ConfigService,
  granted: Parameters<typeof mayCall>[0]
): WorkflowEntry[] =>
  (config.workflows ?? []).filter(
    (entry) => entry.called && mayCall(granted, entry.key)
  );

const notFound = (key: string): WorkflowCallResult => ({
  ok: false,
  error: {
    code: "not_found",
    message: `There is no workflow called ${key}`,
    object: "workflow",
    id: key,
  },
  runId: null,
});

export const createWorkflowCalls = ({
  db,
  pipeline,
  clock,
  stepActions,
  definitions,
  durable,
}: WorkflowCallsOptions) => {
  const events = new Map<string, z.ZodType>();
  for (const definition of definitions) {
    if (definition.kind !== "query") {
      for (const [type, payload] of Object.entries(definition.emits)) {
        events.set(type, payload as z.ZodType);
      }
    }
  }
  /** What a run reads under `config`: its workflows, by key, and events. */
  const contextOf = (config: ConfigService): RunContext => ({
    config,
    workflows: new Map<string, WorkflowDefinition>(
      (config.workflows ?? []).map((workflow) => [
        workflow.key,
        definitionOf(workflow),
      ])
    ),
    events,
  });
  const runner = createRunner({
    db,
    actions: stepActions,
    clock,
    ...(durable
      ? {
          durable: {
            name: durable.name,
            databaseUrl: durable.databaseUrl,
            context: () => contextOf(durable.config()),
            ...(durable.retries ? { retries: durable.retries } : {}),
            ...(durable.waitMs === undefined ? {} : { waitMs: durable.waitMs }),
          },
        }
      : {}),
  });

  /** The earlier run with `retryKey`, if this caller made the same call. */
  const replay = async (
    entry: WorkflowEntry,
    input: unknown,
    originUserId: string | null,
    retryKey: string
  ): Promise<WorkflowCallResult | null> => {
    const actor = await runner.actorOf(entry.key);
    const earlier = await findRetriedRun(db, actor.id, retryKey);
    if (!earlier) {
      return null;
    }
    if (
      earlier.originUserId !== originUserId ||
      !isDeepStrictEqual(earlier.input, input ?? {})
    ) {
      return {
        ok: false,
        error: failures.conflict(
          "This retry key was already used for a different call. Use a new key."
        ).error,
        runId: null,
      };
    }
    if (earlier.status !== "succeeded") {
      // Still going: the same run, not a second one (P2.20).
      return {
        ok: true,
        output: null,
        runId: earlier.id,
        replayed: true,
        pending: earlier.status as "running" | "waiting" | "needs_attention",
      };
    }
    return {
      ok: true,
      output: earlier.output,
      runId: earlier.id,
      replayed: true,
    };
  };

  /**
   * Calls the workflow `key` for `caller`: its output, or the typed error
   * (a declared one carries `declared: true`). A workflow the caller may
   * not call is `not_found` only when it doesn't exist; otherwise it is a
   * permission error naming it.
   */
  const call = async (
    key: string,
    input: unknown,
    caller: Caller,
    { retryKey, method = "POST" }: WorkflowCallOptions = {}
  ): Promise<WorkflowCallResult> => {
    const who = await pipeline.whoIs(caller);
    if (!who.ok) {
      return { ok: false, error: who.error, runId: null };
    }
    const all = who.config.workflows ?? [];
    const entry = all.find((workflow) => workflow.key === key);
    if (!entry?.called) {
      return notFound(key);
    }
    if (method === "GET" && !entry.readOnly) {
      return {
        ok: false,
        error: {
          code: "not_found",
          message: `${key} changes data, so it is POST /workflows/${key}, not GET`,
          object: "workflow",
          id: key,
        },
        runId: null,
      };
    }
    if (!mayCall(who.granted, key)) {
      return {
        ok: false,
        error: failures.forbidden(
          key,
          `Your roles don't let you call the workflow ${key}`
        ).error,
        runId: null,
      };
    }
    if (retryKey !== undefined) {
      const earlier = await replay(entry, input, who.originUserId, retryKey);
      if (earlier) {
        return earlier;
      }
    }
    const result = await runner.run(definitionOf(entry), input, {
      originUserId: who.originUserId,
      ...contextOf(who.config),
      ...(retryKey === undefined ? {} : { retryKey }),
    });
    if (!result.ok) {
      return { ok: false, error: result.error, runId: result.runId };
    }
    return result.pending
      ? {
          ok: true,
          output: null,
          runId: result.runId,
          replayed: false,
          pending: result.status,
        }
      : {
          ok: true,
          output: result.output,
          runId: result.runId,
          replayed: false,
        };
  };

  return { call, actorOf: runner.actorOf, runner, events, contextOf };
};

export type WorkflowCalls = ReturnType<typeof createWorkflowCalls>;
