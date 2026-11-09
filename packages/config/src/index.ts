// Config types and reading `config/` (decision 0037), validateConfig
//, the loader, and the git config service and drafts.
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
