import { describe, expect, it } from "vitest";

import { getRouter } from "./router.tsx";

describe(getRouter, () => {
  it("registers the app routes", () => {
    const router = getRouter();
    expect(Object.keys(router.routesByPath)).toStrictEqual(
      expect.arrayContaining(["/", "/sign-in", "/o/$object"])
    );
  });
});
