// Config types and reading `config/` (P2.03, decision 0037). validateConfig,
// the loader, the git config service and drafts follow in phase 2.
// See docs/SYSTEM_DESIGN.md, section 4.4 Config.
export { defineConfigType, referenceKinds } from "./config-type.ts";
export type {
  AnyConfigType,
  ConfigPath,
  ConfigType,
  Keyed,
  Reference,
  ReferenceKind,
} from "./config-type.ts";
export {
  ConfigError,
  configExtension,
  formatProblem,
  loadConfig,
  readConfig,
  valuesOf,
} from "./read.ts";
export type { ConfigFile, ConfigProblem, ConfigRead } from "./read.ts";
export { roleConfigType, roleReferences } from "./roles.ts";
export {
  choiceConfigType,
  choiceListSchema,
  choiceOptionSchema,
} from "./choices.ts";
export type { ChoiceList } from "./choices.ts";

export { coreConfigTypes } from "./core-types.ts";
export {
  checkChoiceLists,
  checkReferences,
  validateConfig,
} from "./validate.ts";
export type { ChoiceFieldUse, ConfigCatalog } from "./validate.ts";
export { createConfigLoader, workingTreeSha } from "./loader.ts";
export type {
  ConfigIndex,
  ConfigLoader,
  ConfigLoaderOptions,
  LoadResult,
} from "./loader.ts";
