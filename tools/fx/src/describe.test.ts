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
    "shows each action's kind, and the actions workflow steps run",
    { timeout: 30_000 },
    async () => {
      const contact = formatDescribe(await describeSystem(repoRoot, "contact"));
      const check = formatDescribe(
        await describeSystem(repoRoot, "record_in_state")
      );
      expect(contact).toMatch(/contact_update \(internal\)/u);
      expect(contact).toMatch(/Step actions[\s\S]*contact_get \(internal\)/u);
      expect(check).toContain(
        "wrong_state: The record isn't in the expected state."
      );
    }
  );

  it("lists each workflow with its segments", { timeout: 30_000 }, async () => {
    const deal = formatDescribe(await describeSystem(repoRoot, "deal"));
    const paused = formatDescribe({
      system: "s",
      dir: "d",
      match: "workflow",
      description: {
        objects: [],
        actions: [],
        queries: [],
        events: [],
        workflows: [
          {
            key: "payment_make",
            label: null,
            description: "Pay later.",
            source: "code",
            startsWhen: "called",
            readOnly: false,
            segments: [
              {
                steps: ["check"],
                queued: [],
                ends: { step: "wait_a_day", why: "waits", conditional: false },
              },
              { steps: ["capture"], queued: ["notify"], ends: null },
            ],
            problems: [],
            warnings: [],
          },
        ],
      },
    });
    expect(deal).toContain(
      "deal_move_stage (called)  Move a deal to another stage. A lost deal needs a reason.  config/workflows/deal_move_stage.yaml\n    1 segment: load, check_reason, update, announce"
    );
    expect(paused).toContain(
      "    2 segments:\n      1. check\n         then wait_a_day: waits\n      2. capture; after it commits: notify"
    );
  });

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
