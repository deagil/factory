import { describe, expect, it } from "vitest";

describe("CI proof", () => {
  it("fails on purpose", () => {
    expect(1).toBe(2);
  });
});
