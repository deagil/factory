import { describe, expect, it } from "vitest";

import { packageName } from "./index.ts";

describe("@workspace/server", () => {
  it("is the placeholder package", () => {
    expect(packageName).toBe("@workspace/server");
  });
});
