import { describe, expect, it } from "vitest";

import { interpretRemoteCheck } from "./github.ts";

describe(interpretRemoteCheck, () => {
  it("stays pending until the check job finishes", () => {
    expect(
      interpretRemoteCheck({
        url: "https://github.com/acme/factory/pull/1",
        statusCheckRollup: [
          {
            name: "check",
            status: "IN_PROGRESS",
            conclusion: null,
            detailsUrl: "https://github.com/acme/factory/actions/runs/9",
          },
        ],
      })
    ).toStrictEqual({
      state: "pending",
      url: "https://github.com/acme/factory/actions/runs/9",
      detail: null,
    });
  });

  it("passes when the check job succeeds", () => {
    expect(
      interpretRemoteCheck({
        statusCheckRollup: [
          {
            name: "check",
            status: "COMPLETED",
            conclusion: "SUCCESS",
            detailsUrl: "https://github.com/acme/factory/actions/runs/9",
          },
        ],
      }).state
    ).toBe("passed");
  });

  it("fails when the check job fails", () => {
    expect(
      interpretRemoteCheck({
        statusCheckRollup: [
          {
            name: "check",
            status: "COMPLETED",
            conclusion: "FAILURE",
            detailsUrl: "https://github.com/acme/factory/actions/runs/9",
          },
        ],
      })
    ).toMatchObject({
      state: "failed",
      url: "https://github.com/acme/factory/actions/runs/9",
    });
  });
});
