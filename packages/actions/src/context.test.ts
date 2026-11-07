import { describe, expect, it } from "vitest";
import { z } from "zod";

import { createActionContext, createQueryContext } from "./context.ts";
import { isActionFailure } from "./errors.ts";
import { services } from "./test-helpers.ts";

const action = {
  name: "deal.close",
  emits: {
    "deal.closed": z.object({ dealId: z.string(), at: z.coerce.date() }),
  },
};

describe("the action context", () => {
  it("carries the services it was given and the error helpers", () => {
    const given = services();
    const { ctx } = createActionContext(action, given);
    expect(ctx.repo).toBe(given.repo);
    expect(ctx.dal).toBe(given.dal);
    expect(ctx.actor).toStrictEqual(given.actor);
    expect(ctx.clock.now().toISOString()).toBe("2026-11-07T09:00:00.000Z");
    expect(isActionFailure(ctx.conflict("Moved on"))).toBeTruthy();
  });

  it("is frozen, so a handler can't add to it", () => {
    const { ctx } = createActionContext(action, services());
    expect(Object.isFrozen(ctx)).toBeTruthy();
  });

  it("collects emitted events in order, with parsed payloads", () => {
    const { ctx, events } = createActionContext(action, services());
    ctx.emit("deal.closed", { dealId: "d1", at: "2026-11-07T09:00:00Z" });
    ctx.emit("deal.closed", { dealId: "d2", at: "2026-11-07T10:00:00Z" });
    expect(events().map((event) => event.payload)).toStrictEqual([
      { dealId: "d1", at: new Date("2026-11-07T09:00:00Z") },
      { dealId: "d2", at: new Date("2026-11-07T10:00:00Z") },
    ]);
  });

  it("refuses an event the action doesn't declare", () => {
    const { ctx } = createActionContext(action, services());
    const emit = ctx.emit as (type: string, payload: unknown) => void;
    expect(() => emit("deal.deleted", {})).toThrow(
      /emitted "deal\.deleted", which isn't in its emits/u
    );
    expect(() => emit("toString", {})).toThrow(/which isn't in its emits/u);
  });

  it("refuses a payload that doesn't fit the event's schema", () => {
    const { ctx, events } = createActionContext(action, services());
    expect(() =>
      ctx.emit("deal.closed", { dealId: 1, at: "x" } as never)
    ).toThrow(/doesn't fit its schema/u);
    expect(events()).toStrictEqual([]);
  });
});

describe("the query context", () => {
  it("has no repository and no emit", () => {
    const ctx = createQueryContext(services());
    expect("repo" in ctx).toBeFalsy();
    expect("emit" in ctx).toBeFalsy();
    expect(ctx.config.sha).toBeNull();
    expect(Object.isFrozen(ctx)).toBeTruthy();
  });
});
