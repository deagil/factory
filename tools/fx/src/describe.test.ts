import path from "node:path";

import { describe, expect, it } from "vitest";

import {
  describeSystem,
  findSystems,
  formatDescribe,
} from "./commands/describe.ts";

const repoRoot = path.resolve(import.meta.dirname, "../../..");

describe("fx describe", () => {
  it("finds the systems packages declare", async () => {
    const systems = await findSystems(repoRoot);
    expect(systems.map((system) => system.dir)).toContain(
      path.join("examples", "crm")
    );
  });

  it(
    "describes one object with its actions, queries and events",
    { timeout: 30_000 },
    async () => {
      const result = await describeSystem(repoRoot, "contact");
      expect(result.match).toBe("object");
      expect(result.description.actions.map((action) => action.name)).toContain(
        "contact.moveToOrganisation"
      );
      expect(result.description.events.map((event) => event.type)).toContain(
        "contact.moved"
      );
      expect(formatDescribe(result)).toMatch(
        /organisation\s+ref → organisation\s+required$/mu
      );
      const deals = await describeSystem(repoRoot, "deal");
      expect(formatDescribe(deals)).toMatch(
        /stage\s+choice\s+required\s+Lead, Qualified, Proposal sent, Won, Lost/u
      );
    }
  );

  it(
    "shows one action's schemas, and refuses an unknown name",
    { timeout: 30_000 },
    async () => {
      const result = await describeSystem(
        repoRoot,
        "contact.moveToOrganisation"
      );
      expect(formatDescribe(result)).toContain('"organisation"');
      await expect(describeSystem(repoRoot, "nope")).rejects.toThrow(/nope/u);
    }
  );
});
