import { describe, expect, it } from "vitest";

import { packageName } from "./index.ts";

describe("@workspace/sdk", () => {
  it("is the placeholder package", () => {
    expect(packageName).toBe("@workspace/sdk");
  });
});
