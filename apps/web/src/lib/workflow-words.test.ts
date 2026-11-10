import type { Condition } from "@workspace/workflows";
import { describe, expect, it } from "vitest";

import {
  conditionWords,
  conditionsWords,
  durationWords,
  fixedWords,
  pathWords,
  scheduleWords,
  sourceWords,
  startWords,
  workflowFacts,
} from "./workflow-words.ts";

describe(conditionWords, () => {
  it("has a sentence for each of the nine operators", () => {
    const field = "input.amount";
    const cases: [Condition, string][] = [
      [
        { field: "input.stage.category", is: "lost" },
        "the stage's category is lost",
      ],
      [{ field, is_not: 3 }, "the amount is not 3"],
      [{ field, one_of: ["a", "b", "c"] }, "the amount is one of a, b or c"],
      [{ field, not_one_of: ["a", "b"] }, "the amount is not one of a or b"],
      [{ field, above: 10 }, "the amount is above 10"],
      [{ field, at_least: 10 }, "the amount is at least 10"],
      [{ field, below: 10 }, "the amount is below 10"],
      [{ field, at_most: 10 }, "the amount is at most 10"],
      [{ field: "input.reason", empty: true }, "the reason is empty"],
      [
        { field: "event.after.owner", empty: false },
        "the after's owner is not empty",
      ],
      [
        { field: "steps.load.output.record.stage", is: "won" },
        "the record's stage from the step Load is won",
      ],
    ];
    for (const [condition, words] of cases) {
      expect(conditionWords(condition)).toBe(words);
    }
  });

  it("joins conditions with and", () => {
    expect(
      conditionsWords([
        { field: "input.stage.category", is: "lost" },
        { field: "input.reason", empty: true },
      ])
    ).toBe("the stage's category is lost and the reason is empty");
  });
});

describe(sourceWords, () => {
  it("says where each kind of value comes from", () => {
    expect({
      input: sourceWords({ from: "input.deal" }),
      event: sourceWords({ from: "event.record.id" }),
      step: sourceWords({ from: "steps.load.output.record.stage" }),
      output: pathWords("steps.load.output"),
      text: sourceWords({ value: "Thank the customer" }),
      flag: fixedWords(true),
      nothing: fixedWords(null),
      list: fixedWords([1, 2]),
    }).toStrictEqual({
      input: "the deal from the input",
      event: "the record's id from the event",
      step: "the record's stage from the step Load",
      output: "the output of the step Load",
      text: "“Thank the customer”",
      flag: "yes",
      nothing: "nothing",
      list: "[1,2]",
    });
  });
});

describe(durationWords, () => {
  it("names the unit, singular for one", () => {
    expect(
      ["30s", "1m", "2h", "3d", "1w", "soon"].map(durationWords)
    ).toStrictEqual([
      "30 seconds",
      "1 minute",
      "2 hours",
      "3 days",
      "1 week",
      "soon",
    ]);
  });
});

describe(scheduleWords, () => {
  it("phrases common schedules in UTC", () => {
    expect(
      [
        "0 9 * * 1-5",
        "30 14 * * *",
        "0 8 * * 1",
        "0 0 1 * *",
        "*/15 * * * *",
        "0 * * * *",
      ].map((schedule) => scheduleWords(schedule, "UTC").text)
    ).toStrictEqual([
      "Every weekday at 09:00 UTC",
      "Every day at 14:30 UTC",
      "Every Monday at 08:00 UTC",
      "On day 1 of every month at 00:00 UTC",
      "Every 15 minutes",
      "Every hour, on the hour",
    ]);
  });

  it("puts the viewer's time beside it, and none when they are in UTC", () => {
    expect(scheduleWords("0 9 * * 1-5", "UTC").local).toBeNull();
    expect(scheduleWords("0 9 * * 1-5", "Asia/Tokyo").local).toBe(
      "18:00 GMT+9"
    );
  });

  it("falls back to the five named fields", () => {
    expect(scheduleWords("0 9 1,15 */2 *", "UTC")).toStrictEqual({
      text: "On the schedule minute 0, hour 9, day of month 1,15, month */2, day of week * (UTC)",
      local: null,
    });
  });
});

describe(startWords, () => {
  it("says each kind of start", () => {
    expect({
      called: startWords("called").text,
      custom: startWords({
        event: "deal_stage_changed",
        when: [{ field: "event.to.category", is: "won" }],
      }).text,
      record: startWords({ event: "organisation_created" }).text,
      schedule: startWords({ schedule: "0 9 * * 1-5" }, "UTC").text,
      unknown: startWords(null).text,
    }).toStrictEqual({
      called: "When someone runs it",
      custom: "When deal stage changed, if the to's category is won",
      record: "When an organisation is created",
      schedule: "Every weekday at 09:00 UTC",
      unknown: "Unknown start",
    });
  });
});

describe(workflowFacts, () => {
  it("lists the input, the output and the errors in words", () => {
    expect(
      workflowFacts({
        key: "deal_move_stage",
        description: "Move a deal.",
        starts_when: "called",
        input: {
          deal: { type: "ref", object: "deal" },
          stage: { type: "choice", list: "deal_stages" },
          reason: { type: "text", optional: true },
        },
        output: { deal: { from: "steps.update.output.record" } },
        errors: { reason_required: "A lost deal needs a reason." },
        steps: [{ id: "load", action: "deal_get" }],
      })
    ).toStrictEqual({
      input: [
        { name: "deal", words: "a deal" },
        { name: "stage", words: "one of deal stages" },
        { name: "reason", words: "text, optional" },
      ],
      output: [{ name: "deal", words: "the record from the step Update" }],
      errors: [
        { name: "reason_required", words: "A lost deal needs a reason." },
      ],
    });
  });
});
