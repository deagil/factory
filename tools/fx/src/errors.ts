/** Error codes agents can branch on. Every FxError carries one. */
export type FxErrorCode =
  | "usage"
  | "not_in_repo"
  | "state_invalid"
  | "change_exists"
  | "change_not_found"
  | "dirty_worktree"
  | "schema_push_failed"
  | "command_failed";

/**
 * An expected failure: something the person or agent can fix. The CLI prints
 * the message and the hint, never a stack trace.
 */
export class FxError extends Error {
  readonly code: FxErrorCode;
  readonly hint: string | undefined;

  constructor(code: FxErrorCode, message: string, hint?: string) {
    super(message);
    this.name = "FxError";
    this.code = code;
    this.hint = hint;
  }
}
