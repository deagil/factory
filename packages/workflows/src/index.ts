// Workflows (SYSTEM_DESIGN §4.6; decisions 0045, 0046 and 0048). P2.16:
// the definition, `defineWorkflow`, the `workflows` config type and
// validation with segments. P2.17: the runner, for runs with no pauses.
// P2.18: entries, which the surfaces read. P2.20: durable runs, with DBOS.
export { fieldOf, fieldSpecSchema, schemaOf } from "./fields.ts";
export type { FieldSpec, FieldSpecs } from "./fields.ts";
export {
  conditionOperators,
  conditionSchema,
  operatorOf,
  sourceSchema,
  stepSchema,
  workflowSchema,
} from "./schema.ts";
export type {
  ActionStep,
  ApprovalStep,
  Condition,
  ConditionOperator,
  EmitStep,
  FailStep,
  IfStep,
  OnFailure,
  OutputStep,
  RunStep,
  Source,
  StartsWhen,
  Step,
  WaitStep,
  WorkflowDefinition,
} from "./schema.ts";
export { defineWorkflow } from "./define-workflow.ts";
export type { WorkflowInput } from "./define-workflow.ts";
export { validateWorkflow } from "./validate.ts";
export type {
  ScopeField,
  Segment,
  SegmentEnd,
  WorkflowCheck,
  WorkflowContext,
  WorkflowProblem,
  WorkflowScopes,
} from "./validate.ts";
export { createRunner, maxDepth, startsOn } from "./run.ts";
export type {
  AttendResult,
  Attending,
  DurableOptions,
  Runner,
  RunContext,
  RunError,
  RunnerOptions,
  RunStart,
  WorkflowResult,
  WorkflowRunOptions,
} from "./run.ts";
export {
  contextOf,
  workflowConfigType,
  workflowReferences,
  workflowsIn,
} from "./config-type.ts";
export { definitionOf, workflowEntries } from "./entries.ts";
export { coreWorkflowActions, coreWorkflows } from "./code.ts";
export { cronMatches } from "./cron.ts";
