// defineAction and defineQuery, the action registry, the context handlers
// get, and typed errors. The pipeline, permissions and approvals follow in
// P1.07 to P1.11. See docs/SYSTEM_DESIGN.md section 4.2 and decision 0019.
export { createActionContext, createQueryContext } from "./context.ts";
export type { ActionServices, EmittedEvent, QueryServices } from "./context.ts";
export {
  actionKinds,
  defineAction,
  defineQuery,
  namePattern,
  objectJobs,
} from "./define-action.ts";
export type {
  ActionContext,
  ActionDefinition,
  ActionKind,
  ActionOptions,
  Actor,
  AnyActionDefinition,
  AnyDefinition,
  AnyQueryDefinition,
  ApprovalService,
  Clock,
  ConfigAuthor,
  ConfigCheck,
  ConfigCheckProblem,
  ConfigCommit,
  ConfigFileDiff,
  ConfigService,
  ContextFor,
  Emit,
  ErrorMessages,
  EventSchemas,
  ExternalContext,
  Fail,
  GitService,
  HandlerResult,
  NoErrors,
  NoEvents,
  ObjectJob,
  ObjectPermission,
  ObjectSchema,
  PublishResult,
  QueryContext,
  QueryDefinition,
  QueryOptions,
  ResumeResult,
  WorkflowEntry,
} from "./define-action.ts";
export {
  approvalRuleSchema,
  conditionHolds,
  conditionOperators,
  conditionSchema,
  describeSignOffs,
  rulesForAction,
  rulesForFiles,
  signOffsFor,
  unmetSignOff,
} from "./approval-rules.ts";
export type {
  ApprovalRule,
  Condition,
  RecordLoader,
  RuleValues,
  SignOff,
} from "./approval-rules.ts";
export {
  approvalApprove,
  approvalCheck,
  approvalDefinitions,
  approvalEntrySchema,
  approvalList,
  approvalReject,
  approvalWithdraw,
} from "./approvals.ts";
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
  DeclaredError,
  ApprovalRequiredError,
  ConflictError,
  ErrorHelpers,
  NotFoundError,
  UnavailableError,
  PermissionError,
  ValidationError,
  ValidationIssue,
} from "./errors.ts";
export { createRegistry } from "./registry.ts";
export type { RegisteredEvent, Registry } from "./registry.ts";
export { createPipeline, pin as pinConfig } from "./pipeline.ts";
export type {
  ActionResult,
  Caller,
  InternalError,
  Pipeline,
  PipelineOptions,
  QueryResult,
  RecordChange,
  RunError,
  RunOptions,
} from "./pipeline.ts";
export {
  generateDefinitions,
  type ObjectEndpoint,
  objectEndpoints,
} from "./generated.ts";
export {
  allowAll,
  beyond,
  everythingRole,
  fieldListSchema,
  grantedBy,
  intersect,
  mayCall,
  objectRulesSchema,
  permissionNameOf,
  rolePermissions,
  roleSchema,
  rowScopes,
} from "./permissions.ts";
export type {
  FieldList,
  Granted,
  ObjectGrant,
  ObjectRules,
  Permissions,
  Role,
  RowScope,
} from "./permissions.ts";
export {
  allGranted,
  describeFor,
  describeOutput,
  describeQuery,
  describeWorkflowField,
} from "./describe.ts";
export { historyEntrySchema, historyQuery } from "./history.ts";
export {
  changeEntrySchema,
  eventEntrySchema,
  runDetailSchema,
  runEntrySchema,
  runStepEntrySchema,
} from "./log-schemas.ts";
export {
  actorGet,
  actorList,
  apiKeyList,
  identityQueries,
  roleList,
} from "./identity-queries.ts";
export {
  actorDetailSchema,
  actorEntrySchema,
  apiKeyEntrySchema,
} from "./identity-schemas.ts";
export {
  auditLogGet,
  auditLogList,
  eventLogGet,
  eventLogList,
  logQueries,
  runGet,
  runList,
  runNeedsAttention,
} from "./logs.ts";
export type { HistoryEntry } from "./history.ts";
export type { ApprovalEntry } from "./approvals.ts";
export type {
  ChangeEntry,
  EventEntry,
  RunDetail,
  RunEntry,
  RunStepEntry,
} from "./log-schemas.ts";
export type { DescribeOptions, SystemDescription } from "./describe.ts";
export { checkActions } from "./checks.ts";
export { recordActions, stepActions } from "./record-actions.ts";
export { retryKeyOf, runExternalStep, runInternalStep } from "./step.ts";
export type { StepOptions, StepPlace, StepResult } from "./step.ts";
