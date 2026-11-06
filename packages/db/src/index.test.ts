import { describe, expect, it } from "vitest";

import { packageName } from "./index.ts";

describe("@workspace/db", () => {
  it("is the placeholder package", () => {
    expect(packageName).toBe("@workspace/db");
  });
});
