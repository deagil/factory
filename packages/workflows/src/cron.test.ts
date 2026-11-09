import { describe, expect, it } from "vitest";

import { cronMatches } from "./cron.ts";

const at = (iso: string) => new Date(iso);

describe(cronMatches, () => {
  it("matches minutes, hours, ranges, steps and weekdays in UTC", () => {
    // 2026-11-09 is a Monday.
    expect(
      [
        ["0 9 * * 1-5", "2026-11-09T09:00:30Z"],
        ["0 9 * * 1-5", "2026-11-08T09:00:00Z"],
        ["*/15 * * * *", "2026-11-09T10:45:00Z"],
        ["*/15 * * * *", "2026-11-09T10:46:00Z"],
        ["0 0 1 * 7", "2026-11-08T00:00:00Z"],
        ["30 8 9,10 11 *", "2026-11-09T08:30:00Z"],
      ].map(([expression = "", iso = ""]) => cronMatches(expression, at(iso)))
    ).toStrictEqual([true, false, true, false, true, true]);
  });
});
