// defineAction and defineQuery, the action registry, the context handlers
// get, and typed errors. The pipeline, permissions and approvals follow in
// P1.07 to P1.11. See docs/SYSTEM_DESIGN.md section 4.2 and decision 0019.
export { createActionContext, createQueryContext } from "./context.ts";
export type { ActionServices, EmittedEvent, QueryServices } from "./context.ts";
export {
  defineAction,
  defineQuery,
  namePattern,
  objectVerbs,
} from "./define-action.ts";
export type {
  ActionContext,
  ActionDefinition,
  ActionOptions,
  Actor,
  AnyActionDefinition,
  AnyDefinition,
  AnyQueryDefinition,
  Clock,
  ConfigService,
  Emit,
  EventSchemas,
  HandlerResult,
  NoEvents,
  ObjectPermission,
  ObjectSchema,
  ObjectVerb,
  QueryContext,
  QueryDefinition,
  QueryOptions,
} from "./define-action.ts";
export {
  actionErrorCodes,
  failures,
  isActionFailure,
  issuesFrom,
} from "./errors.ts";
export type {
  ActionError,
  ActionErrorCode,
  ActionFailure,
  ApprovalRequiredError,
  ConflictError,
  ErrorHelpers,
  NotFoundError,
  PermissionError,
  ValidationError,
  ValidationIssue,
} from "./errors.ts";
export { createRegistry } from "./registry.ts";
export type { RegisteredEvent, Registry } from "./registry.ts";
export { createPipeline } from "./pipeline.ts";
export type {
  ActionResult,
  ApprovalRules,
  Caller,
  InternalError,
  Pipeline,
  PipelineOptions,
  QueryResult,
  RecordChange,
  RunError,
  RunOptions,
} from "./pipeline.ts";
export { generateDefinitions } from "./generated.ts";
export {
  allowAll,
  grantedBy,
  intersect,
  permissionNameOf,
  permissionSchema,
  rolePermissions,
  roleSchema,
  scopes,
} from "./permissions.ts";
export type { Granted, Permission, Permissions, Role } from "./permissions.ts";
export {
  allGranted,
  describeFor,
  describeOutput,
  describeQuery,
} from "./describe.ts";
export { historyEntrySchema, historyQuery } from "./history.ts";
export type { HistoryEntry } from "./history.ts";
export type { DescribeOptions, SystemDescription } from "./describe.ts";
