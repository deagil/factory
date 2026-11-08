import { approvalConfigType } from "./approvals.ts";
import { choiceConfigType } from "./choices.ts";
import type { AnyConfigType } from "./config-type.ts";
import { roleConfigType } from "./roles.ts";

/** The config types the core registers. Modules add theirs. */
export const coreConfigTypes: readonly AnyConfigType[] = [
  choiceConfigType,
  roleConfigType,
  approvalConfigType,
];
