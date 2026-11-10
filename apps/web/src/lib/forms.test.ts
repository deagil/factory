import { describe, expect, it } from "vitest";

import type { SystemDescription } from "./api.ts";
import {
  customActions,
  formFields,
  fromFormValues,
  humanise,
  toFormValues,
} from "./forms.ts";
import type { ActionDescription, FormField } from "./forms.ts";
import type { ObjectDescription } from "./records.ts";

const contact = {
  name: "contact",
  fields: [
    { key: "firstName", label: "First name", type: "text", target: null },
    {
      key: "organisation",
      label: "Organisation",
      type: "ref",
      target: "organisation",
      write: false,
    },
    { key: "active", label: "Active", type: "boolean", target: null },
  ],
} as unknown as ObjectDescription;

const update = {
  name: "contact_update",
  input: {
    properties: {
      firstName: {},
      organisation: {},
      active: {},
      id: {},
      version: {},
      customFields: {},
    },
    required: ["id"],
  },
} as unknown as ActionDescription;

const move = {
  name: "contact.moveToOrganisation",
  input: {
    properties: { id: {}, organisation: {}, version: {} },
    required: ["id", "organisation"],
  },
} as unknown as ActionDescription;

describe("forms from action inputs", () => {
  it("has a control only for what the action takes and the caller can write", () => {
    expect(formFields(update, contact).map((field) => field.key)).toStrictEqual(
      ["firstName", "active"]
    );
    expect(formFields(move, contact)).toStrictEqual([
      {
        key: "organisation",
        label: "Organisation",
        type: "ref",
        target: "organisation",
        required: true,
        options: null,
        list: null,
      },
    ]);
  });

  it("sends only changed fields on an update, and clears to null", () => {
    const fields = formFields(update, contact);
    const record = { firstName: "Ada", active: true };
    expect(
      fromFormValues(fields, { firstName: "", active: true }, record)
    ).toStrictEqual({
      firstName: null,
    });
    expect(
      fromFormValues(fields, { firstName: "", active: false })
    ).toStrictEqual({
      active: false,
    });
  });

  it("edits money in major units, with the currency's decimal places", () => {
    const value = {
      key: "value",
      label: "Value",
      type: "money",
      target: null,
      required: false,
      options: null,
      list: null,
    } satisfies FormField;
    const record = { value: { amount: 1_200_000, currency: "GBP" } };
    expect(toFormValues([value], record)).toStrictEqual({ value: "12000.00" });
    expect(
      fromFormValues([value], { value: "12000.00" }, record)
    ).toStrictEqual({});
    expect(fromFormValues([value], { value: "120.5" })).toStrictEqual({
      value: { amount: 12_050, currency: "GBP" },
    });
    expect(
      toFormValues([value], { value: { amount: 5000, currency: "JPY" } })
    ).toStrictEqual({ value: "5000" });
    expect(
      fromFormValues(
        [value],
        { value: "5000" },
        { value: { amount: 5000, currency: "JPY" } }
      )
    ).toStrictEqual({});
  });

  it("shows a url without its http prefix and sends the typed text", () => {
    const website = {
      key: "website",
      type: "url",
    } as unknown as FormField;
    expect(
      toFormValues([website], { website: "https://acme.example/path" })
    ).toStrictEqual({ website: "acme.example/path" });
    expect(
      fromFormValues([website], { website: "acme.example" })
    ).toStrictEqual({ website: "acme.example" });
  });

  it("finds the hand-written actions and names them", () => {
    const description = {
      actions: [
        update,
        move,
        { name: "contact_restore" },
        { name: "organisation.merge" },
      ],
    } as unknown as SystemDescription;
    expect(
      customActions(description, "contact").map((a) => a.name)
    ).toStrictEqual(["contact.moveToOrganisation"]);
    expect(humanise("moveToOrganisation")).toBe("Move to organisation");
  });
});
