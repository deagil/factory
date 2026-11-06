import { helpText, parseCliArgs } from "./args.ts";
import type { ParsedArgs } from "./args.ts";
import { formatStatus, status } from "./commands/status.ts";
import { writeError, writeResult } from "./output.ts";

/** Runs one fx invocation and returns its exit code. */
export const run = async (
  argv: readonly string[],
  cwd: string = process.cwd()
): Promise<number> => {
  let args: ParsedArgs | undefined;
  try {
    args = parseCliArgs(argv);
    if (args.help || args.command === undefined) {
      writeResult(
        args.json,
        { help: helpText(args.command) },
        helpText(args.command)
      );
      return 0;
    }
    switch (args.command) {
      case "status": {
        const report = await status(cwd);
        writeResult(args.json, report, formatStatus(report));
        return 0;
      }
      default: {
        const unreachable: never = args.command;
        throw new Error(`Unhandled command ${String(unreachable)}`);
      }
    }
  } catch (error) {
    writeError(args?.json ?? argv.includes("--json"), error);
    return (error as { code?: string }).code === "usage" ? 2 : 1;
  }
};
