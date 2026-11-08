import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { defineChoiceList } from "@workspace/objects";
import { describe, expect, it } from "vitest";
import { z } from "zod";

import {
  choiceConfigType,
  formatProblem,
  roleConfigType,
  validateConfig,
} from "./index.ts";
import type { ConfigCatalog } from "./index.ts";

const catalog: ConfigCatalog = {
  objects: new Map([["contact", ["firstName", "email"]]]),
  actions: new Set(["contact.moveToOrganisation"]),
  objectActions: new Map([
    ["contact.create", { object: "contact", can: "create" }],
  ]),
  events: new Set(["contact.created"]),
  choiceLists: [],
};

describe(validateConfig, () => {
  it("names each reference the running system doesn't have", () => {
    const dir = path.join(
      mkdtempSync(path.join(tmpdir(), "config-")),
      "config"
    );
    mkdirSync(path.join(dir, "roles"), { recursive: true });
    writeFileSync(
      path.join(dir, "roles", "sales.yaml"),
      `key: sales
label: Sales
permissions:
  - object: contact
    can: [view]
    scope: all
  - object: deal
    can: [view]
    scope: all
  - action: contact.moveToOrganisation
    scope: all
  - action: contact.create
    scope: all
  - action: contact.merge
    scope: all
`
    );
    const { files, problems } = validateConfig(dir, [roleConfigType], catalog);
    expect(files).toHaveLength(1);
    expect(problems.map(formatProblem)).toStrictEqual([
      'config/roles/sales.yaml:7 permissions.1.object: There is no object "deal". Objects: contact.',
      "config/roles/sales.yaml:12 permissions.3.action: contact.create is generated for contact, so grant it as an object permission: object: contact, can: [create].",
      'config/roles/sales.yaml:14 permissions.4.action: There is no action or query "contact.merge".',
    ]);
  });
});

/** A config folder holding one choice list, stages, with these options. */
const listOf = (options: string) => {
  const dir = path.join(mkdtempSync(path.join(tmpdir(), "config-")), "config");
  mkdirSync(path.join(dir, "choices"), { recursive: true });
  writeFileSync(
    path.join(dir, "choices", "stages.yaml"),
    `key: stages\noptions:\n${options}`
  );
  return dir;
};

/** The problems with `options` when code defines stages as `list`. */
const check = (
  options: string,
  list?: Parameters<typeof defineChoiceList>[0]
) => {
  const defined = list && defineChoiceList(list);
  return validateConfig(listOf(options), [choiceConfigType], {
    ...catalog,
    choiceLists: defined
      ? [
          {
            key: defined.key,
            keys: defined.keys,
            option: defined.option,
            usedBy: ["deal.stage"],
          },
        ]
      : [],
  }).problems.map(formatProblem);
};

const options = `  - { key: open, label: Open, category: open }
  - { key: won, label: Won, category: won, archived: true }
  - { key: later, label: Later, category: someday }
`;

describe("choice lists against their definitions", () => {
  it("checks each row's own columns against the list's schema", () => {
    expect(
      check(options, {
        key: "stages",
        columns: { category: z.enum(["open", "won", "lost"]) },
      })
    ).toStrictEqual([
      'config/choices/stages.yaml:5 options.2.category: Invalid option: expected one of "open"|"won"|"lost"',
    ]);
  });

  it("refuses a column the list doesn't define", () => {
    expect(check(options)).toStrictEqual(
      [3, 4, 5].map(
        (line) =>
          `config/choices/stages.yaml:${line} options.${line - 3}.category: "category" isn't a column of stages. Columns: archived, description, key, label. New columns are defined in code.`
      )
    );
  });

  it("holds a list with fixed keys to exactly those, none archived", () => {
    expect(
      check(options, {
        key: "stages",
        keys: ["open", "won"],
        columns: { category: z.string() },
      })
    ).toStrictEqual([
      'config/choices/stages.yaml:4 options.1.archived: Code acts on each key of stages, so "won" can\'t be archived.',
      'config/choices/stages.yaml:5 options.2.key: Code acts on each key of stages (open, won), so "later" can\'t be added here. New keys ship with the code that handles them.',
    ]);
  });

  it("names a list code uses that doesn't exist", () => {
    expect(
      validateConfig(listOf(options), [choiceConfigType], {
        ...catalog,
        choiceLists: [
          {
            key: "kinds",
            option: defineChoiceList({ key: "kinds" }).option,
            usedBy: ["deal.kind"],
          },
        ],
      })
        .problems.map(formatProblem)
        .filter((problem) => problem.includes("kinds"))
    ).toStrictEqual([
      "config/choices/kinds.yaml deal.kind uses this list, but the file doesn't exist.",
    ]);
  });
});
