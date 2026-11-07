// Better Auth sign-in and sessions, API keys, and resolving either to the
// caller an action runs as. See docs/SYSTEM_DESIGN.md section 4.3.
export { createAuth, printCode } from "./auth.ts";
export type { Auth, AuthOptions, SendCode } from "./auth.ts";
export {
  createAgent,
  createApiKey,
  createIntegration,
  identityActions,
  revokeApiKey,
} from "./actions.ts";
