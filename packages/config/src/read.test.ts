import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import {
  formatProblem,
  readConfig,
  roleConfigType,
  roleReferences,
} from "./index.ts";

/** A `config/` folder with these files, by path under it. */
const configWith = (files: Record<string, string>): string => {
  const dir = path.join(mkdtempSync(path.join(tmpdir(), "config-")), "config");
  for (const [file, text] of Object.entries(files)) {
    mkdirSync(path.dirname(path.join(dir, file)), { recursive: true });
    writeFileSync(path.join(dir, file), text);
  }
  return dir;
};

const support = `key: support
label: Support
objects:
  contact:
    endpoints: [get, update]
    rows: all
workflows:
  - contact.moveToOrganisation
`;

describe(readConfig, () => {
  it("reads a valid file and lists what it references", () => {
    const { files, problems } = readConfig(
      configWith({ "roles/support.yaml": support }),
      [roleConfigType]
    );
    expect(problems).toStrictEqual([]);
    expect(files).toMatchObject([
      { type: "roles", key: "support", file: "config/roles/support.yaml" },
    ]);
    expect(roleReferences(files[0]?.value as never)).toStrictEqual([
      { kind: "object", name: "contact", path: ["objects", "contact"] },
      {
        kind: "endpoint",
        name: "contact_get",
        path: ["objects", "contact", "endpoints", 0],
      },
      {
        kind: "endpoint",
        name: "contact_update",
        path: ["objects", "contact", "endpoints", 1],
      },
      {
        kind: "action",
        name: "contact.moveToOrganisation",
        path: ["workflows", 0],
      },
    ]);
  });

  it("names the file, path and line of each problem", () => {
    const { files, problems } = readConfig(
      configWith({
        "roles/renamed.yaml": support,
        "roles/bad.yaml": support
          .replace("key: support", "key: bad")
          .replace("rows: all", "rows: some"),
        "roles/alias.yaml": "key: &k alias\nlabel: *k\n",
        "roles/notes.txt": "",
        "widgets/a.yaml": "key: a\n",
      }),
      [roleConfigType]
    );
    expect(files).toStrictEqual([]);
    expect(problems.map(formatProblem)).toStrictEqual([
      "config/roles/alias.yaml:2 Anchors and aliases aren't allowed; write the value out.",
      expect.stringMatching(
        /^config\/roles\/bad\.yaml:6 objects\.contact\.rows: /u
      ),
      "config/roles/notes.txt Config files end in .yaml.",
      'config/roles/renamed.yaml:1 key: The key is "support" but the file is named renamed.yaml; they must match.',
      'config/widgets There is no config type "widgets". Types: roles.',
    ]);
  });
});
