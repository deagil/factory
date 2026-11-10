// Config types and reading `config/` (P2.03, decision 0037), validateConfig
// (P2.04), the loader (P2.05), and the git config service and drafts (P2.08).
// See docs/SYSTEM_DESIGN.md, section 4.4 Config.
export { defineConfigType, referenceKinds } from "./config-type.ts";
export type {
  AnyConfigType,
  ConfigCheckContext,
  ConfigCheckProblem,
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
export { approvalConfigType, approvalReferences } from "./approvals.ts";
export {
  choiceConfigType,
  choiceListSchema,
  choiceLookup,
  choiceOptionSchema,
  plainChoiceOption,
} from "./choices.ts";
export type { ChoiceList } from "./choices.ts";

export { coreConfigTypes } from "./core-types.ts";
export {
  checkChoiceLists,
  checkReferences,
  validateConfig,
} from "./validate.ts";
export type { ChoiceListUse, ConfigCatalog } from "./validate.ts";
export { createConfigLoader, workingTreeSha } from "./loader.ts";
export type {
  ConfigIndex,
  ConfigLoader,
  ConfigLoaderOptions,
  ConfigLoaderSource,
  LoadResult,
} from "./loader.ts";
export { parse as parseYaml, stringify as stringifyYaml } from "yaml";
export { createGitConfigService, ensureLocalRemote } from "./git.ts";
export type { GitConfigOptions, GitConfigService } from "./git.ts";
export {
  draftDefinitions,
  draftDiscard,
  draftFiles,
  draftGet,
  draftList,
  draftMine,
  draftOpen,
  draftPublish,
  draftRevert,
  draftSave,
  titleFor,
} from "./drafts.ts";
