import { describe, expect, it } from "vitest";

import { roles } from "./roles.ts";

describe("the CRM's roles", () => {
  it("load from config/roles", () => {
    expect(roles.map((role) => role.key)).toStrictEqual([
      "admin",
      "sales",
      "support",
      "website",
    ]);
    expect(
      roles.find((role) => role.key === "sales")?.permissions
    ).toContainEqual({ action: "contact.moveToOrganisation", scope: "all" });
  });
});
