import { helpText, parseCliArgs } from "./args.ts";
import type { ParsedArgs } from "./args.ts";
import { dev } from "./commands/dev.ts";
import { done, formatDone } from "./commands/done.ts";
import { formatShip, ship } from "./commands/ship.ts";
import { formatStart, start } from "./commands/start.ts";
import { formatStatus, status } from "./commands/status.ts";
import { formatSwitch, switchTo } from "./commands/switch.ts";
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
      case "start": {
        const [name = ""] = args.positionals;
        const change = await start(cwd, name, {
          skipInstall: args.options["skip-install"] === true,
        });
        writeResult(args.json, { change }, formatStart(change, cwd));
        return 0;
      }
      case "ship": {
        const contractStep = args.options["contract-step"];
        const result = await ship(cwd, {
          contractStep:
            typeof contractStep === "string" ? contractStep : undefined,
        });
        writeResult(args.json, result, formatShip(result));
        return 0;
      }
      case "switch": {
        const [name = ""] = args.positionals;
        const result = await switchTo(cwd, name);
        if (args.options.path === true && !args.json) {
          process.stdout.write(`${result.cd}\n`);
        } else {
          writeResult(args.json, result, formatSwitch(result, cwd));
        }
        return 0;
      }
      case "done": {
        const [name] = args.positionals;
        const result = await done(cwd, name, {
          force: args.options.force === true,
        });
        writeResult(args.json, result, formatDone(result));
        return 0;
      }
      case "dev": {
        // Long-running: it writes its own output as it goes.
        return await dev(cwd, {
          reset: args.options.reset === true,
          json: args.json,
        });
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
