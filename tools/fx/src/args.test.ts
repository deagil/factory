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

  it("parses fx switch and fx done", () => {
    expect(parseCliArgs(["switch", "deal pipeline", "--path"])).toMatchObject({
      command: "switch",
      positionals: ["deal pipeline"],
      options: { path: true },
    });
    expect(parseCliArgs(["done", "--force"])).toMatchObject({
      command: "done",
      positionals: [],
      options: { force: true },
    });
  });

  it("parses fx ship --contract-step", () => {
    expect(
      parseCliArgs(["ship", "--contract-step", "x is unused since #12"])
    ).toMatchObject({
      command: "ship",
      options: { "contract-step": "x is unused since #12" },
    });
  });

  it("parses fx dev --reset", () => {
    expect(parseCliArgs(["dev", "--reset", "--json"])).toStrictEqual({
      command: "dev",
      positionals: [],
      options: { reset: true },
      json: true,
      help: false,
    });
  });

  it.each([
    [["nope"], /Unknown command "nope"/u],
    [["dev", "extra"], /Wrong number of arguments/u],
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
