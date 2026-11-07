// Better Auth sign-in and sessions, and resolving them to actors. Roles and
// API keys follow in P1.11 and P1.12. See docs/SYSTEM_DESIGN.md section 4.3.
export { createAuth, printCode } from "./auth.ts";
export type { Auth, AuthOptions, SendCode } from "./auth.ts";
