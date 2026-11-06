// The factory CLI and, later, its MCP server. See docs/SYSTEM_DESIGN.md,
// section 7. Agents. The entry point is src/cli.ts.
export { commands, helpText, parseCliArgs } from "./args.ts";
export type { CommandName, ParsedArgs } from "./args.ts";
export {
  createPushQueue,
  dev,
  formatDevEvent,
  pushFailure,
  pushSchema,
  schemaDir,
  watchSchema,
} from "./commands/dev.ts";
export type { DevEvent, DevOptions, PushResult } from "./commands/dev.ts";
export { formatStatus, status } from "./commands/status.ts";
export type { StatusReport } from "./commands/status.ts";
export { FxError } from "./errors.ts";
export { run } from "./run.ts";
export type { FxErrorCode } from "./errors.ts";
export {
  changeForPath,
  findChange,
  listChanges,
  parseChange,
  removeChange,
  saveChange,
} from "./state.ts";
export type { Change, CheckResult } from "./state.ts";
