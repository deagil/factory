// Typed errors: the expected ways an action or query fails. Handlers return
// them instead of throwing (AGENTS.md rule 8), and every surface maps them
// to its own shape: HTTP status codes, MCP tool errors. See decision 0019.

import type { z } from "zod";

/** Where in the input a problem is, and what it is. */
export interface ValidationIssue {
  path: (string | number)[];
  message: string;
}

/** The input, or something a handler checked, isn't acceptable. */
export interface ValidationError {
  code: "validation";
  message: string;
  issues: ValidationIssue[];
}

/** The actor lacks a permission. `permission` names it, such as `deal.moveStage`. */
export interface PermissionError {
  code: "permission";
  message: string;
  permission: string;
}

/** An approval rule matched, so the action waits for sign-off. */
export interface ApprovalRequiredError {
  code: "approval_required";
  message: string;
  rule: string;
}

/** The record moved on, or the change clashes with its current state. */
export interface ConflictError {
  code: "conflict";
  message: string;
}

/** The record isn't there, or the actor may not see it. */
export interface NotFoundError {
  code: "not_found";
  message: string;
  object: string;
  id: string;
}

/** Every typed error, told apart by `code`. Plain JSON. */
export type ActionError =
  | ValidationError
  | PermissionError
  | ApprovalRequiredError
  | ConflictError
  | NotFoundError;

export type ActionErrorCode = ActionError["code"];

/** Every code, for surfaces that map them. */
export const actionErrorCodes = [
  "validation",
  "permission",
  "approval_required",
  "conflict",
  "not_found",
] as const satisfies readonly ActionErrorCode[];

const failureBrand: unique symbol = Symbol("ActionFailure");

/**
 * A typed error, as a handler returns it. The brand tells it apart from an
 * output that happens to look like an error.
 */
export interface ActionFailure<TError extends ActionError = ActionError> {
  readonly [failureBrand]: true;
  readonly error: TError;
}

const fail = <TError extends ActionError>(
  error: TError
): ActionFailure<TError> =>
  Object.freeze({ [failureBrand]: true as const, error });

/** Whether `value` is a typed error a handler returned (or threw). */
export const isActionFailure = (value: unknown): value is ActionFailure =>
  typeof value === "object" &&
  value !== null &&
  (value as Partial<ActionFailure>)[failureBrand] === true;

/** Issues from a Zod error, with paths a JSON client can read. */
export const issuesFrom = (error: z.ZodError): ValidationIssue[] =>
  error.issues.map((issue) => ({
    path: issue.path.map((part) =>
      typeof part === "number" ? part : String(part)
    ),
    message: issue.message,
  }));

/**
 * The error helpers. Handlers get them on `ctx` (`return ctx.notFound(…)`);
 * the pipeline uses them too.
 */
export const failures = {
  /** The input, or something the handler checked, isn't acceptable. */
  invalid: (message: string, issues: ValidationIssue[] = []) =>
    fail({ code: "validation", message, issues }),
  /** A Zod error as a validation failure. */
  invalidInput: (error: z.ZodError, message = "The input isn't valid") =>
    fail({ code: "validation", message, issues: issuesFrom(error) }),
  /** The actor lacks `permission`. */
  forbidden: (permission: string, message?: string) =>
    fail({
      code: "permission",
      message: message ?? `This needs the permission ${permission}`,
      permission,
    }),
  /** The approval rule `rule` matched. */
  needsApproval: (rule: string, message?: string) =>
    fail({
      code: "approval_required",
      message: message ?? `This needs approval under the rule ${rule}`,
      rule,
    }),
  /** The change clashes with the record's current state. */
  conflict: (message: string) => fail({ code: "conflict", message }),
  /** There is no `object` with this `id` that the actor may see. */
  notFound: (object: string, id: string) =>
    fail({
      code: "not_found",
      message: `There is no ${object} with the id ${id}`,
      object,
      id,
    }),
};

export type ErrorHelpers = typeof failures;
