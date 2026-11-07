import { describe, expect, it } from "vitest";

import { codeFor } from "./session.ts";

describe(codeFor, () => {
  const session = {
    users: [],
    outbox: [
      { email: "sam@example.com", code: "222222", at: "2026-11-07T10:00:05Z" },
      { email: "Sam@example.com", code: "111111", at: "2026-11-07T09:00:00Z" },
    ],
  };

  it("takes the newest code for the email, ignoring case", () => {
    expect(
      codeFor(session, "SAM@example.com", new Date("2026-11-07T10:00:00Z"))
    ).toBe("222222");
  });

  it("ignores codes sent before the request", () => {
    expect(
      codeFor(session, "sam@example.com", new Date("2026-11-07T11:00:00Z"))
    ).toBeUndefined();
  });
});
