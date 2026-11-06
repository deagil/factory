import { describe, expect, it } from "vitest";

import { packageName } from "./index.ts";

describe("@workspace/auth", () => {
  it("is the placeholder package", () => {
    expect(packageName).toBe("@workspace/auth");
  });
});
