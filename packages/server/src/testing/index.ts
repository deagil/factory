// Test support for systems built on the server: contract tests across
// surfaces. Import from `@workspace/server/testing` in tests only.
export {
  httpSurface,
  configSamples,
  identitySamples,
  mcpSurface,
  restSurface,
  runContract,
  runWorkflowContract,
  workflowHttpSurface,
  workflowMcpSurface,
} from "./contract.ts";
export type {
  ContractOptions,
  ContractProblem,
  Surface,
  SurfaceCall,
  WorkflowCase,
  WorkflowSurface,
} from "./contract.ts";
export { createSystemDatabase } from "./database.ts";
export type { SystemDatabase } from "./database.ts";
