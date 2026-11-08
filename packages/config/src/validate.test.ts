import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { formatProblem, roleConfigType, validateConfig } from "./index.ts";
import type { ConfigCatalog } from "./index.ts";

const catalog: ConfigCatalog = {
  objects: new Map([["contact", ["firstName", "email"]]]),
  actions: new Set(["contact.moveToOrganisation"]),
  objectActions: new Map([
    ["contact.create", { object: "contact", can: "create" }],
  ]),
  events: new Set(["contact.created"]),
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
