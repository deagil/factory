import { describe, expect, it } from "vitest";

import { labelFor, snakeCase, tableNameFor } from "./naming.ts";

describe("naming", () => {
  it("turns camelCase into snake_case", () => {
    expect(snakeCase("expectedClose")).toBe("expected_close");
    expect(snakeCase("addressLine1")).toBe("address_line1");
    expect(snakeCase("name")).toBe("name");
  });

  it("makes plural table names", () => {
    expect(
      [
        "deal",
        "activity",
        "day",
        "bookingClass",
        "box",
        "match",
        "contact",
      ].map(tableNameFor)
    ).toStrictEqual([
      "deals",
      "activities",
      "days",
      "booking_classes",
      "boxes",
      "matches",
      "contacts",
    ]);
  });

  it("makes labels from names", () => {
    expect(labelFor("expectedClose")).toBe("Expected close");
    expect(labelFor("deal")).toBe("Deal");
  });
});
