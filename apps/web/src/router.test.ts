import { describe, expect, it } from "vitest";

import { getRouter } from "./router.tsx";

describe(getRouter, () => {
  it("registers the index route", () => {
    const router = getRouter();
    expect(Object.keys(router.routesByPath)).toContain("/");
  });
});
