// The CRM's roles, read from config/roles/*.yaml (decision 0037). From
// P2.05 the config loader owns them and defineSystem no longer takes roles.
import path from "node:path";

import { loadConfig, roleConfigType, valuesOf } from "@workspace/config";

export const configDir = path.resolve(import.meta.dirname, "../config");

export const roles = valuesOf(
  loadConfig(configDir, [roleConfigType]),
  roleConfigType
);
