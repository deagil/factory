import { describe, expect, it } from "vitest";

import { packageName } from "./index.ts";

describe("@workspace/events", () => {
  it("is the placeholder package", () => {
    expect(packageName).toBe("@workspace/events");
  });
});
