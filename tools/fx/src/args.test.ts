import { describe, expect, it } from "vitest";

import { helpText, parseCliArgs } from "./args.ts";

describe(parseCliArgs, () => {
  it("shows help with no arguments", () => {
    expect(parseCliArgs([])).toMatchObject({
      command: undefined,
      help: true,
      json: false,
    });
  });

  it("shows help as JSON with only --json", () => {
    expect(parseCliArgs(["--json"])).toMatchObject({
      command: undefined,
      help: true,
      json: true,
    });
  });

  it("parses a command", () => {
    expect(parseCliArgs(["status"])).toStrictEqual({
      command: "status",
      positionals: [],
      options: {},
      json: false,
      help: false,
    });
  });

  it("parses --json and --help after the command", () => {
    expect(parseCliArgs(["status", "--json"])).toMatchObject({
      command: "status",
      json: true,
    });
    expect(parseCliArgs(["status", "-h"])).toMatchObject({
      command: "status",
      help: true,
    });
  });

  it.each([
    [["nope"], /Unknown command "nope"/u],
    [["status", "--bogus"], /--bogus/u],
    [["status", "extra"], /Wrong number of arguments/u],
  ])("refuses %j with a usage error", (argv, message) => {
    expect(() => parseCliArgs(argv)).toThrow(message);
    expect(() => parseCliArgs(argv)).toThrow(
      expect.objectContaining({ name: "FxError", code: "usage" })
    );
  });
});

describe(helpText, () => {
  it("lists the commands", () => {
    expect(helpText()).toContain("status");
  });

  it("shows a command's usage", () => {
    expect(helpText("status")).toContain("Usage: fx status [--json]");
  });
});
