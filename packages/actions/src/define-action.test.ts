import { describe, expect, expectTypeOf, it } from "vitest";
import { z } from "zod";

import { createActionContext, createQueryContext } from "./context.ts";
import { defineAction, defineQuery } from "./define-action.ts";
import type { ActionContext, QueryContext } from "./define-action.ts";
import { isActionFailure } from "./errors.ts";
import { services } from "./test-helpers.ts";

const stageChanged = z.object({
  dealId: z.string(),
  from: z.string(),
  to: z.string(),
});

const moveStage = defineAction({
  name: "deal.moveStage",
  description: "Move a deal to another pipeline stage",
  input: z.object({ dealId: z.string(), stage: z.string() }),
  output: z.object({ dealId: z.string(), stage: z.string() }),
  emits: { "deal.stageChanged": stageChanged },
  handler: (ctx, { dealId, stage }) => {
    if (stage === "nowhere") {
      return ctx.invalid("There is no stage called nowhere", [
        { path: ["stage"], message: "Unknown stage" },
      ]);
    }
    ctx.emit("deal.stageChanged", { dealId, from: "lead", to: stage });
    return { dealId, stage };
  },
});

const getDeal = defineQuery({
  name: "deal.get",
  description: "One deal by id",
  input: z.object({ id: z.string() }),
  output: z.object({ id: z.string() }),
  handler: (ctx, { id }) =>
    id === "missing" ? ctx.notFound("deal", id) : { id },
});

describe(defineAction, () => {
  it("returns a frozen definition with its schemas and events", () => {
    expect(moveStage.kind).toBe("action");
    expect(moveStage.name).toBe("deal.moveStage");
    expect(Object.keys(moveStage.emits)).toStrictEqual(["deal.stageChanged"]);
    expect(Object.isFrozen(moveStage)).toBeTruthy();
    expect(Object.isFrozen(moveStage.emits)).toBeTruthy();
  });

  it("has no events unless it declares some", () => {
    const archive = defineAction({
      name: "deal.archive",
      description: "Archive a deal",
      input: z.object({ id: z.string() }),
      output: z.object({}),
      handler: () => ({}),
    });
    expect(archive.emits).toStrictEqual({});
  });

  it("runs its handler with the context it's given", async () => {
    const { ctx, events } = createActionContext(moveStage, services());
    const output = await moveStage.handler(ctx, {
      dealId: "d1",
      stage: "won",
    });
    expect(output).toStrictEqual({ dealId: "d1", stage: "won" });
    expect(events()).toStrictEqual([
      {
        type: "deal.stageChanged",
        payload: { dealId: "d1", from: "lead", to: "won" },
      },
    ]);
  });

  it("returns typed errors rather than throwing", async () => {
    const { ctx } = createActionContext(moveStage, services());
    const result = await moveStage.handler(ctx, {
      dealId: "d1",
      stage: "nowhere",
    });
    expect(isActionFailure(result)).toBeTruthy();
    expect(isActionFailure(result) && result.error.code).toBe("validation");
  });

  it.each([
    ["Deal.move", /must be <object>\.<verb>/u],
    ["deal", /must be <object>\.<verb>/u],
    ["deal.move.now", /must be <object>\.<verb>/u],
    ["deal.move_stage", /must be <object>\.<verb>/u],
  ])("refuses the name %s", (name, message) => {
    expect(() =>
      defineAction({
        name,
        description: "x",
        input: z.object({}),
        output: z.object({}),
        handler: () => ({}),
      })
    ).toThrow(message);
  });

  it("needs a description", () => {
    expect(() =>
      defineAction({
        name: "deal.move",
        description: "  ",
        input: z.object({}),
        output: z.object({}),
        handler: () => ({}),
      })
    ).toThrow(/a description is required/u);
  });

  it("refuses badly named events", () => {
    expect(() =>
      defineAction({
        name: "deal.move",
        description: "Move a deal",
        input: z.object({}),
        output: z.object({}),
        emits: { "deal-moved": z.object({}) },
        handler: () => ({}),
      })
    ).toThrow(/the event "deal-moved" must be <object>\.<pastTense>/u);
  });
});

describe(defineQuery, () => {
  it("returns a frozen query definition", () => {
    expect(getDeal.kind).toBe("query");
    expect(Object.isFrozen(getDeal)).toBeTruthy();
    expect("emits" in getDeal).toBeFalsy();
  });

  it("returns not_found as a typed error", async () => {
    const result = await getDeal.handler(createQueryContext(services()), {
      id: "missing",
    });
    expect(isActionFailure(result) && result.error).toStrictEqual({
      code: "not_found",
      message: "There is no deal with the id missing",
      object: "deal",
      id: "missing",
    });
  });

  it("refuses a bad name", () => {
    expect(() =>
      defineQuery({
        name: "deals",
        description: "All deals",
        input: z.object({}),
        output: z.object({}),
        handler: () => ({}),
      })
    ).toThrow(/defineQuery\("deals"\)/u);
  });
});

// These run under `pnpm typecheck`: each @ts-expect-error must be an error.
describe("types", () => {
  it("only lets an action emit the events it declares, with their payloads", () => {
    defineAction({
      name: "deal.close",
      description: "Close a deal",
      input: z.object({ dealId: z.string() }),
      output: z.object({}),
      emits: { "deal.closed": z.object({ dealId: z.string() }) },
      handler: (ctx, { dealId }) => {
        ctx.emit("deal.closed", { dealId });
        // @ts-expect-error an event the action doesn't declare
        ctx.emit("deal.deleted", { dealId });
        // @ts-expect-error a payload that doesn't fit the schema
        ctx.emit("deal.closed", { id: dealId });
        return {};
      },
    });
    expect(true).toBeTruthy();
  });

  it("lets an action that declares no events emit nothing", () => {
    defineAction({
      name: "deal.touch",
      description: "Touch a deal",
      input: z.object({}),
      output: z.object({}),
      handler: (ctx) => {
        // @ts-expect-error no events are declared
        ctx.emit("deal.touched", {});
        return {};
      },
    });
    expect(true).toBeTruthy();
  });

  it("types the handler's input and output from the schemas", () => {
    defineAction({
      name: "deal.rename",
      description: "Rename a deal",
      input: z.object({ title: z.string(), note: z.string().optional() }),
      output: z.object({ title: z.string() }),
      handler: (_ctx, input) => {
        expectTypeOf(input).toEqualTypeOf<{ title: string; note?: string }>();
        return { title: input.title };
      },
    });
    defineAction({
      name: "deal.rename",
      description: "Rename a deal",
      input: z.object({ title: z.string() }),
      output: z.object({ title: z.string() }),
      // @ts-expect-error the output needs a title
      handler: (_ctx, input) => ({ name: input.title }),
    });
    expect(true).toBeTruthy();
  });

  it("gives queries no way to write or emit", () => {
    expectTypeOf<QueryContext>().not.toHaveProperty("repo");
    expectTypeOf<QueryContext>().not.toHaveProperty("emit");
    expectTypeOf<ActionContext>().toHaveProperty("repo");
    expectTypeOf<ActionContext>().toHaveProperty("dal");
    expect(true).toBeTruthy();
  });

  it("gives handlers services only through ctx", () => {
    expectTypeOf<keyof ActionContext>().toEqualTypeOf<
      | "repo"
      | "identity"
      | "drafts"
      | "approvals"
      | "dryRun"
      | "dal"
      | "granted"
      | "config"
      | "git"
      | "clock"
      | "actor"
      | "originUserId"
      | "emit"
      | "invalid"
      | "invalidInput"
      | "forbidden"
      | "needsApproval"
      | "conflict"
      | "notFound"
    >();
    expect(true).toBeTruthy();
  });
});
