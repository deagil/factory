import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

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
  choiceFields: [],
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

const check = (control: "system" | "mapped" | "custom", options: string) =>
  validateConfig(listOf(options), [choiceConfigType], {
    ...catalog,
    choiceFields: [
      {
        object: "deal",
        field: "stage",
        list: "stages",
        control,
        keys: ["open", "won"],
        categories: ["open", "won"],
      },
    ],
  }).problems.map(formatProblem);

const options = `  - { key: open, label: Open, category: open }
  - { key: won, label: Won, category: won, archived: true }
  - { key: later, label: Later, category: someday }
`;

describe("choice lists and their fields' control", () => {
  it("lets staff change anything in a custom list", () => {
    expect(check("custom", options)).toStrictEqual([]);
  });

  it("holds a mapped list to the categories code acts on", () => {
    expect(check("mapped", options)).toStrictEqual([
      'config/choices/stages.yaml:5 options.2.category: "someday" isn\'t a category deal.stage acts on. Categories: open, won.',
    ]);
  });

  it("holds a system list to exactly the keys code acts on, none archived", () => {
    expect(check("system", options)).toStrictEqual([
      "config/choices/stages.yaml:4 options.1.archived: deal.stage is a system choice, so its options can't be archived: code acts on each one.",
      'config/choices/stages.yaml:5 options.2.key: deal.stage is a system choice, and code only acts on open, won, so "later" can\'t be added here. New keys ship with the code that handles them.',
    ]);
  });

  it("names a list a field uses that doesn't exist", () => {
    expect(
      validateConfig(listOf(options), [choiceConfigType], {
        ...catalog,
        choiceFields: [
          { object: "deal", field: "kind", list: "kinds", control: "custom" },
        ],
      }).problems.map(formatProblem)
    ).toStrictEqual([
      "config/choices/kinds.yaml deal.kind uses this list, but the file doesn't exist.",
    ]);
  });
});
