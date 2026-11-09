// Workflows (SYSTEM_DESIGN §4.6; decisions 0045, 0046 and 0048). P2.16:
// the definition, `defineWorkflow`, the `workflows` config type and
// validation with segments. The runner comes with P2.17.
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
  Segment,
  SegmentEnd,
  WorkflowCheck,
  WorkflowContext,
  WorkflowProblem,
} from "./validate.ts";
export {
  contextOf,
  workflowConfigType,
  workflowReferences,
  workflowsIn,
} from "./config-type.ts";
