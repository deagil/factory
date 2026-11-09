import { describe, expect, it } from "vitest";
import { z } from "zod";

import { defineAction, defineQuery } from "./define-action.ts";
import type { EventSchemas } from "./define-action.ts";
import { createRegistry } from "./registry.ts";

const moved = z.object({ contactId: z.string() });

const action = (name: string, emits: EventSchemas = {}) =>
  defineAction({
    name,
    kind: "internal",
    description: `The ${name} action`,
    input: z.object({ id: z.string() }),
    output: z.object({}),
    emits,
    handler: () => ({}),
  });

const query = (name: string) =>
  defineQuery({
    name,
    description: `The ${name} query`,
    input: z.object({ id: z.string() }),
    output: z.object({}),
    handler: () => ({}),
  });

describe("the registry", () => {
  it("lists every action and query with its schemas", () => {
    const create = action("contact_create");
    const get = query("contact_get");
    const registry = createRegistry([create, get]);
    expect(registry.list()).toStrictEqual([create, get]);
    expect(registry.actions()).toStrictEqual([create]);
    expect(registry.queries()).toStrictEqual([get]);
    expect(registry.get("contact_get")?.input).toBe(get.input);
    expect(registry.get("contact.delete")).toBeUndefined();
  });

  it("refuses two actions with the same name", () => {
    expect(() =>
      createRegistry([action("contact_create"), action("contact_create")])
    ).toThrow(/"contact_create" is registered twice, as two actions/u);
  });

  it("refuses the same definition twice", () => {
    const create = action("contact_create");
    expect(() => createRegistry([create, create])).toThrow(/registered twice/u);
  });

  it("refuses an action and a query with the same name", () => {
    expect(() =>
      createRegistry([action("contact_get"), query("contact_get")])
    ).toThrow(/registered twice, as an action and a query/u);
  });

  it("lists events with the actions that declare them", () => {
    const registry = createRegistry([
      action("contact.move", { "contact.moved": moved }),
      action("contact.moveToOrganisation", { "contact.moved": moved }),
      action("contact_archive", { contact_archived: z.object({}) }),
    ]);
    expect(
      registry.events().map(({ type, emittedBy }) => ({ type, emittedBy }))
    ).toStrictEqual([
      {
        type: "contact.moved",
        emittedBy: ["contact.move", "contact.moveToOrganisation"],
      },
      { type: "contact_archived", emittedBy: ["contact_archive"] },
    ]);
  });

  it("refuses one event declared with two schemas", () => {
    expect(() =>
      createRegistry([
        action("contact.move", { "contact.moved": moved }),
        action("contact.relocate", {
          "contact.moved": z.object({ contactId: z.string() }),
        }),
      ])
    ).toThrow(
      /"contact\.moved" is declared by contact\.move and contact\.relocate with different schemas/u
    );
  });

  it("can't be changed through what it returns", () => {
    const registry = createRegistry([action("contact_create")]);
    registry.list().pop();
    expect(registry.list()).toHaveLength(1);
    expect(Object.isFrozen(registry)).toBeTruthy();
  });
});
