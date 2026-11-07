// Test support for systems built on the server: contract tests across
// surfaces. Import from `@workspace/server/testing` in tests only.
export {
  httpSurface,
  identitySamples,
  mcpSurface,
  runContract,
} from "./contract.ts";
export type {
  ContractOptions,
  ContractProblem,
  Surface,
  SurfaceCall,
} from "./contract.ts";
