import type { AnyConfigType } from "./config-type.ts";
import { roleConfigType } from "./roles.ts";

/** The config types the core registers. Modules add theirs. */
export const coreConfigTypes: readonly AnyConfigType[] = [roleConfigType];
