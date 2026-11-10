import { describe, expect, it } from "vitest";

import {
  eventSource,
  labelsOf,
  mayCall,
  startedBy,
  whatHappensWhen,
} from "./workflow-events.ts";
import type { EventListItem } from "./workflow-events.ts";

const event = (
  type: string,
  from: EventListItem["from"],
  workflows: string[]
): EventListItem => ({
  type,
  payload: { kind: "fields", fields: {} },
  from,
  workflows,
});

const events = [
  event("deal_updated", { kind: "object", name: "deal" }, ["deal_owner_task"]),
  event("deal_created", { kind: "object", name: "deal" }, []),
  event("deal_stage_changed", { kind: "workflow", name: "deal_move_stage" }, [
    "deal_won_task",
  ]),
];

const labels = labelsOf([
  { key: "deal_won_task", label: "Thank the customer" },
]);

describe(startedBy, () => {
  it("lists what each emitted event starts, by label", () => {
    expect(
      startedBy(["deal_stage_changed", "other"], events, labels)
    ).toStrictEqual([
      {
        type: "deal_stage_changed",
        heading: "When deal stage changed",
        workflows: [{ key: "deal_won_task", label: "Thank the customer" }],
      },
      { type: "other", heading: "When other", workflows: [] },
    ]);
  });

  it("lists an object's four events", () => {
    expect(
      whatHappensWhen("deal", events, labels).map((each) => [
        each.heading,
        each.workflows.map((workflow) => workflow.label),
      ])
    ).toStrictEqual([
      ["When a deal is created", []],
      ["When a deal is updated", ["Deal owner task"]],
      ["When a deal is archived", []],
      ["When a deal is restored", []],
    ]);
  });

  it("says where an event comes from, and who may read the lists", () => {
    expect(events.map((each) => eventSource(each.from))).toStrictEqual([
      "Records of deal",
      "Records of deal",
      "The workflow deal move stage",
    ]);
    expect(mayCall([{ key: "event_list" }], "event_list")).toBeTruthy();
    expect(mayCall([{ key: "x" }], "event_list")).toBeFalsy();
  });
});
