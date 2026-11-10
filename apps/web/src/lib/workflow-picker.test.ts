import type { WorkflowCheck } from "@workspace/workflows";
import { describe, expect, it } from "vitest";

import {
  fixedChoices,
  fixedText,
  fixedValue,
  inputSchema,
  pickerGroups,
  schemaType,
  searched,
  splitByFit,
} from "./workflow-picker.ts";

type Scopes = WorkflowCheck["scopes"];
type Field = NonNullable<Scopes["input"]>[number];

const field = (key: string, type: string, more: Partial<Field> = {}): Field =>
  ({ key, label: key, type, optionColumns: null, ...more }) as Field;

const scopes: Scopes = {
  steps: {
    "steps.2": ["load"],
    "steps.3": ["load", "update"],
  },
  outputs: {
    load: {
      type: "object",
      properties: {
        record: {
          type: "object",
          properties: {
            id: { type: "string" },
            amount: { anyOf: [{ type: "integer" }, { type: "null" }] },
          },
        },
      },
    },
    update: { type: "object", properties: { changed: { type: "boolean" } } },
  },
  input: [
    field("deal", "ref"),
    field("stage", "choice", {
      optionColumns: {
        type: "object",
        properties: { category: { type: "string" } },
      },
    }),
  ],
  event: null,
  eventSchema: null,
};

const paths = (stepPath: string, target?: unknown) =>
  pickerGroups(scopes, stepPath, target).map((group) => [
    group.title,
    group.options.map((option) => option.path),
  ]);

describe("what a value may read", () => {
  it("offers the input's fields, with a choice's columns under it", () => {
    expect(paths("steps.0")).toStrictEqual([
      [
        "What the workflow takes",
        ["input.deal", "input.stage", "input.stage.category"],
      ],
    ]);
  });

  it("offers only the steps that have run by then, each browsed by its schema", () => {
    expect(paths("steps.2")[1]).toStrictEqual([
      "The step load",
      [
        "steps.load.output",
        "steps.load.output.record",
        "steps.load.output.record.id",
        "steps.load.output.record.amount",
      ],
    ]);
    expect(paths("steps.3").map(([title]) => title)).toStrictEqual([
      "What the workflow takes",
      "The step load",
      "The step update",
    ]);
  });

  it("sets apart what doesn't suit the input's type", () => {
    const split = splitByFit(
      pickerGroups(scopes, "steps.3", { type: "number" })
    );
    expect(split.fits.flatMap((group) => group.options)).toMatchObject([
      { path: "steps.load.output.record.amount" },
    ]);
    expect(split.rest.map((option) => option.path)).toContain("input.deal");
    expect(split.rest.map((option) => option.path)).toContain(
      "steps.update.output.changed"
    );
  });

  it("offers nothing without scopes", () => {
    expect(pickerGroups(undefined, "steps.0")).toStrictEqual([]);
  });
});

describe("a fixed value", () => {
  it("reads a schema's type, through a nullable one", () => {
    expect(schemaType({ type: "integer" })).toBe("number");
    expect(schemaType({ anyOf: [{ type: "string" }, { type: "null" }] })).toBe(
      "string"
    );
    expect(schemaType(undefined)).toBe("any");
  });

  it("goes between the field's text and the file's value", () => {
    expect(fixedText("won")).toBe("won");
    expect(fixedText(3)).toBe("3");
    expect(fixedValue("3", "number")).toBe(3);
    expect(fixedValue("three", "number")).toBe("three");
    expect(fixedValue("true", "boolean")).toBeTruthy();
  });

  it("lists the options an input must be one of", () => {
    expect(
      fixedChoices({ type: "string", enum: ["open", "won"] })
    ).toStrictEqual(["open", "won"]);
    expect(fixedChoices({ type: "string" })).toBeNull();
  });
});

describe("finding a path", () => {
  it("keeps the options every search word is in", () => {
    const found = searched(pickerGroups(scopes, "steps.3"), "record amount");
    expect(found.flatMap((group) => group.options)).toMatchObject([
      { path: "steps.load.output.record.amount" },
    ]);
  });

  it("reads one input's schema from an action's", () => {
    const input = { type: "object", properties: { id: { type: "string" } } };
    expect(inputSchema(input, "id")).toStrictEqual({ type: "string" });
    expect(inputSchema(undefined, "id")).toBeUndefined();
  });
});
