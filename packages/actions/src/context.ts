// Builds `ctx` for one run of an action or query. The pipeline (P1.07) calls
// these inside the run's transaction, once the action_log row exists, so the
// repository and data access layer are bound to that run. See decision 0019.

import type { DraftStore, IdentityStore } from "@workspace/db";
import type { DataAccess, Repository } from "@workspace/objects";
import { z } from "zod";

import type { SignOff } from "./approval-rules.ts";
import type {
  ActionContext,
  Actor,
  ApprovalService,
  AnyActionDefinition,
  Clock,
  ConfigService,
  EventSchemas,
  GitService,
  QueryContext,
} from "./define-action.ts";
import { failures } from "./errors.ts";
import type { Granted } from "./permissions.ts";

/** The services one run's `ctx` is made from. */
export interface QueryServices {
  dal: DataAccess;
  granted: Granted;
  config: ConfigService;
  git: GitService | undefined;
  clock: Clock;
  actor: Actor;
  originUserId: string | null;
  signOffs?: (action: string, input: unknown) => Promise<SignOff[]>;
}

export interface ActionServices extends QueryServices {
  repo: Repository;
  identity: IdentityStore;
  drafts: DraftStore;
  approvals: ApprovalService;
  dryRun: boolean;
  grantsBeyond: (roles: readonly string[]) => string | null;
}

/** An event an action emitted, its payload checked against its schema. */
export interface EmittedEvent {
  type: string;
  payload: unknown;
}

/** The context a query handler gets. */
export const createQueryContext = (services: QueryServices): QueryContext =>
  Object.freeze({
    ...failures,
    dal: services.dal,
    granted: services.granted,
    config: services.config,
    git: services.git,
    clock: services.clock,
    actor: services.actor,
    originUserId: services.originUserId,
    ...(services.signOffs ? { signOffs: services.signOffs } : {}),
  });

/**
 * The context an action handler gets, and the events it has emitted so far,
 * in order, for the record stage to write to event_log.
 */
export const createActionContext = <TEmits extends EventSchemas>(
  action: Pick<AnyActionDefinition, "name"> & { emits: TEmits },
  services: ActionServices
): { ctx: ActionContext<TEmits>; events: () => EmittedEvent[] } => {
  const emitted: EmittedEvent[] = [];
  const emit = (type: string, payload: unknown) => {
    const schema = Object.hasOwn(action.emits, type)
      ? action.emits[type]
      : undefined;
    if (!schema) {
      throw new Error(
        `${action.name} emitted "${type}", which isn't in its emits. Declare it there.`
      );
    }
    const parsed = schema.safeParse(payload);
    if (!parsed.success) {
      throw new Error(
        `${action.name} emitted "${type}" with a payload that doesn't fit its schema:\n${z.prettifyError(parsed.error)}`
      );
    }
    emitted.push({ type, payload: parsed.data });
  };
  const ctx = Object.freeze({
    ...createQueryContext(services),
    repo: services.repo,
    identity: services.identity,
    drafts: services.drafts,
    approvals: services.approvals,
    dryRun: services.dryRun,
    grantsBeyond: services.grantsBeyond,
    emit,
  }) as ActionContext<TEmits>;
  return { ctx, events: () => [...emitted] };
};
