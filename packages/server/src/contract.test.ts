import type { Caller } from "@workspace/actions";
import { contact, organisation } from "@workspace/objects/testing";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createApi } from "./api.ts";
import { httpSurface, mcpSurface, runContract } from "./testing/contract.ts";
import type { ContractOptions, Surface } from "./testing/contract.ts";
import { createTestApi, registry } from "./testing/test-api.ts";
import type { TestApi } from "./testing/test-api.ts";

/** A surface that changes the input on the way, as a buggy one might. */
const lossy =
  (surface: Surface): Surface =>
  (action, input) =>
    surface(action, { ...(input as object), name: "Changed on the way" });

describe("contract across surfaces", () => {
  let test: TestApi;
  let options: Omit<ContractOptions, "surfaces">;
  let http: Surface;
  let mcp: Surface;

  beforeAll(async () => {
    test = await createTestApi();
    const caller: Caller = test.admin;
    const api = createApi({
      registry,
      pipeline: test.pipeline,
      callerFrom: () => Promise.resolve(caller),
    });
    const request = (path: string, init: RequestInit) =>
      api.request(path, init);
    http = httpSurface(request);
    mcp = mcpSurface(request);

    /** Runs an action directly, as setup for a sample. */
    const setUp = async (name: string, input: unknown) => {
      const action = registry.get(name);
      const result =
        action?.kind === "action" &&
        (await test.pipeline.run(action, input, caller));
      if (!(result && result.ok)) {
        throw new Error(`${name} failed in setup`);
      }
      return result.output as Record<string, string>;
    };
    const agentKey = async () => {
      const { actorId } = await setUp("actor.createAgent", { name: "Helper" });
      return { actorId: actorId ?? "", label: "contract" };
    };

    options = {
      registry,
      objects: [organisation, contact],
      pipeline: test.pipeline,
      db: test.crm.db,
      caller,
      samples: {
        "actor.createAgent": () => Promise.resolve({ name: "Agent" }),
        "actor.createIntegration": () =>
          Promise.resolve({ name: "Site", roles: ["website"] }),
        "apiKey.create": agentKey,
        "apiKey.revoke": async () => {
          const key = await setUp("apiKey.create", await agentKey());
          return { id: key.id };
        },
      },
    };
  });

  afterAll(async () => {
    await test?.crm.close();
  });

  it("gives the same results and log rows over HTTP and MCP for every action", async () => {
    const problems = await runContract({ ...options, surfaces: { http, mcp } });
    expect(problems).toStrictEqual([]);
  });

  it("fails when a surface behaves differently", async () => {
    const problems = await runContract({
      ...options,
      surfaces: { http, lossy: lossy(mcp) },
    });
    expect(problems.map((problem) => problem.action)).toContain(
      "organisation.create"
    );
  });

  it("fails for an action with no sample", async () => {
    const problems = await runContract({
      ...options,
      samples: {},
      surfaces: { http, mcp },
    });
    expect(problems).toContainEqual(
      expect.objectContaining({ action: "apiKey.create", case: "sample" })
    );
  });
});
