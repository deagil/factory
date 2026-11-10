import { describe, expect, expectTypeOf, it } from "vitest";

import { defineObject } from "../define-object.ts";
import type { CreateInput } from "../define-object.ts";
import { f } from "./index.ts";

const id = "00000000-0000-4000-8000-000000000001";

const placard = defineObject({
  name: "placard",
  fields: {
    firstName: f.text({ required: true }),
    lastName: f.text(),
    seats: f.number({ integer: true }),
    spare: f.number({ integer: true }),
    fullName: f.computed({
      type: "text",
      using: "concat",
      fields: ["firstName", "lastName"],
      displayField: true,
    }),
    total: f.computed({
      type: "number",
      using: "add",
      fields: ["seats", "spare"],
    }),
  },
});

const row = {
  id,
  createdAt: new Date("2026-11-10T10:00:00Z"),
  updatedAt: new Date("2026-11-10T10:00:00Z"),
  createdBy: id,
  updatedBy: id,
  archivedAt: null,
  version: 1,
  firstName: "Ada",
  lastName: "Lovelace",
  seats: 2,
  spare: 1,
};

describe("computed fields", () => {
  it("joins text, skipping empty parts", () => {
    const name = f.computed({
      type: "text",
      using: "concat",
      fields: ["firstName", "lastName"],
    });
    expect(name.evaluate({ firstName: "Ada", lastName: "Lovelace" })).toBe(
      "Ada Lovelace"
    );
    expect(name.evaluate({ firstName: "Ada", lastName: null })).toBe("Ada");
    expect(name.evaluate({ firstName: null, lastName: "" })).toBeNull();
  });

  it("takes the first present value, including zero", () => {
    const picked = f.computed({
      type: "number",
      using: "coalesce",
      fields: ["spare", "seats"],
    });
    expect(picked.evaluate({ spare: null, seats: 0 })).toBe(0);
    expect(picked.evaluate({ spare: null, seats: null })).toBeNull();
  });

  it("adds, subtracts and multiplies, and is null when an input is empty", () => {
    expect(
      f
        .computed({ type: "number", using: "add", fields: ["seats", "spare"] })
        .evaluate({ seats: 2, spare: 3 })
    ).toBe(5);
    expect(
      f
        .computed({
          type: "number",
          using: "subtract",
          fields: ["seats", "spare"],
        })
        .evaluate({ seats: 5, spare: 2 })
    ).toBe(3);
    expect(
      f
        .computed({
          type: "number",
          using: "multiply",
          fields: ["seats", "spare"],
        })
        .evaluate({ seats: 4, spare: null })
    ).toBeNull();
  });

  it("refuses an operation that doesn't return the declared type", () => {
    expect(() =>
      f.computed({ type: "text", using: "add", fields: ["seats", "spare"] })
    ).toThrow(/doesn't return text/u);
    expect(() =>
      f.computed({
        type: "number",
        using: "add",
        fields: ["seats", "spare"],
        separator: " ",
      })
    ).toThrow(/separator is only for concat/u);
  });

  it("calculates on read and leaves the value out of create and update", () => {
    expect(placard.fromRow(row)).toMatchObject({
      fullName: "Ada Lovelace",
      total: 3,
    });
    expect(placard.fromRow({ ...row, spare: null }).total).toBeNull();
    expect(
      placard.schemas.create.safeParse({ firstName: "Ada" }).success
    ).toBeTruthy();
    expect(
      placard.schemas.create.safeParse({ firstName: "Ada", fullName: "Ada" })
        .success
    ).toBeFalsy();
    expect(
      placard.schemas.update.safeParse({ fullName: "Ada" }).success
    ).toBeFalsy();
    type Created = CreateInput<(typeof placard)["fields"]>;
    type WritesFullName = "fullName" extends keyof Created ? true : false;
    expectTypeOf<WritesFullName>().toEqualTypeOf<false>();
  });

  it("allows one display field, and an avatar only when it is an image field", () => {
    expect(() =>
      defineObject({
        name: "twoDisplays",
        fields: {
          a: f.text({ displayField: true }),
          b: f.text({ displayField: true }),
        },
      })
    ).toThrow(/only one field can be the display field/u);
    expect(() =>
      defineObject({
        name: "avatarText",
        fields: {
          name: f.text({ displayField: true, avatar: "logo" }),
          logo: f.text(),
        },
      })
    ).toThrow(/isn't an image field/u);
    expect(() =>
      f.computed({
        type: "text",
        using: "concat",
        fields: ["organisation", "organisation"],
      })
    ).toThrow(/named once/u);
    expect(() =>
      defineObject({
        name: "computedRef",
        fields: {
          organisation: f.ref("organisation"),
          other: f.text(),
          label: f.computed({
            type: "text",
            using: "concat",
            fields: ["organisation", "other"],
          }),
        },
      })
    ).toThrow(/"organisation" is ref/u);
  });
});
