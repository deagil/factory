import { describe, expect, it } from "vitest";

import { day, dayEnd, dayStart } from "./day-range.ts";

describe("day range", () => {
  it("turns a calendar day into inclusive local bounds", () => {
    const start = new Date(dayStart("2026-11-23") ?? "");
    const end = new Date(dayEnd("2026-11-23") ?? "");
    expect({
      start: [
        start.getFullYear(),
        start.getMonth(),
        start.getDate(),
        start.getHours(),
      ],
      end: [
        end.getHours(),
        end.getMinutes(),
        end.getSeconds(),
        end.getMilliseconds(),
      ],
    }).toStrictEqual({
      start: [2026, 10, 23, 0],
      end: [23, 59, 59, 999],
    });
    expect(end.getDate()).toBe(23);
  });

  it("rejects a day that is not a date", () => {
    expect(day("2026-13-40")).toBeUndefined();
    expect(dayStart("yesterday")).toBeUndefined();
    expect(dayEnd(undefined)).toBeUndefined();
  });
});
