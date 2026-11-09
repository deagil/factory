import { describe, expect, it } from "vitest";
import { z } from "zod";

import { actionErrorCodes, failures, isActionFailure } from "./errors.ts";

describe("typed errors", () => {
  it("has a helper for every code", () => {
    const codes = [
      failures.invalid("Bad"),
      failures.forbidden("deal.moveStage"),
      failures.needsApproval("large-refund"),
      failures.conflict("Moved on"),
      failures.notFound("deal", "d1"),
      failures.unavailable("The bank is busy"),
    ].map((failure) => failure.error.code);
    expect(codes).toStrictEqual([...actionErrorCodes]);
  });

  it("says which permission was missing", () => {
    expect(failures.forbidden("deal.moveStage").error).toStrictEqual({
      code: "permission",
      message: "This needs the permission deal.moveStage",
      permission: "deal.moveStage",
    });
  });

  it("turns a Zod error into validation issues with JSON paths", () => {
    const parsed = z
      .object({ lines: z.array(z.object({ qty: z.int().min(1) })) })
      .safeParse({ lines: [{ qty: 0 }] });
    const failure = parsed.success
      ? undefined
      : failures.invalidInput(parsed.error);
    expect(failure?.error.code).toBe("validation");
    expect(
      failure?.error.code === "validation" &&
        failure.error.issues.map((issue) => issue.path)
    ).toStrictEqual([["lines", 0, "qty"]]);
  });

  it("tells failures apart from outputs that look like errors", () => {
    const failure = failures.conflict("Moved on");
    expect(isActionFailure(failure)).toBeTruthy();
    expect(isActionFailure({ error: failure.error })).toBeFalsy();
    expect(isActionFailure(null)).toBeFalsy();
    expect(Object.isFrozen(failure)).toBeTruthy();
  });

  it("serialises as plain JSON", () => {
    const { error } = failures.notFound("deal", "d1");
    expect(JSON.stringify(error)).toBe(
      '{"code":"not_found","message":"There is no deal with the id d1","object":"deal","id":"d1"}'
    );
  });
});
