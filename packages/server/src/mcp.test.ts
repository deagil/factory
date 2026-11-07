import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createTestApi, registry } from "./testing/test-api.ts";
import type { TestApi } from "./testing/test-api.ts";

interface Tool {
  name: string;
  title: string;
  inputSchema: { properties?: Record<string, unknown> };
  annotations: { readOnlyHint: boolean };
}

describe("MCP server", () => {
  let test: TestApi;
  let id = 0;

  beforeAll(async () => {
    test = await createTestApi();
  });

  afterAll(async () => {
    await test?.crm.close();
  });

  /** Sends one JSON-RPC message as Claude Code does; returns the reply. */
  const rpc = async (
    method: string,
    params?: unknown,
    key = test.keys.agent
  ) => {
    id += 1;
    const response = await test.api.request("/mcp", {
      method: "POST",
      headers: {
        authorization: `Bearer ${key}`,
        "content-type": "application/json",
        accept: "application/json, text/event-stream",
        "mcp-protocol-version": "2025-06-18",
      },
      body: JSON.stringify({ jsonrpc: "2.0", id, method, params }),
    });
    return {
      status: response.status,
      body: (await response.json()) as { result: Record<string, unknown> },
    };
  };

  it("initialises, lists a tool per definition and creates a record as the agent", async () => {
    const init = await rpc("initialize", {
      protocolVersion: "2025-06-18",
      capabilities: {},
      clientInfo: { name: "claude-code", version: "2" },
    });
    expect(init.body.result).toMatchObject({
      serverInfo: { name: "factory" },
      instructions: expect.any(String),
    });

    const { body } = await rpc("tools/list");
    const tools = body.result.tools as Tool[];
    expect(tools).toHaveLength(registry.list().length);
    expect(
      tools.find((tool) => tool.name === "organisation_list")
    ).toMatchObject({
      title: "organisation.list",
      annotations: { readOnlyHint: true },
    });
    for (const tool of tools) {
      expect(tool.name).toMatch(/^[a-zA-Z0-9_-]{1,64}$/u);
    }

    const called = await rpc("tools/call", {
      name: "organisation_create",
      arguments: { name: "Made by Claude" },
    });
    const { record } = called.body.result.structuredContent as {
      record: { id: string };
    };
    const log = await test.crm.db.query.actionLog.findFirst({
      where: (t, { eq }) => eq(t.name, "organisation.create"),
    });
    expect(record).toMatchObject({ name: "Made by Claude" });
    expect(log).toMatchObject({
      actorId: test.actors.agent,
      originUserId: test.actors.sarahUser,
      status: "succeeded",
    });
  });

  it("advertises each tool's input schema", async () => {
    const { body } = await rpc("tools/list");
    const tool = (body.result.tools as Tool[]).find(
      (each) => each.name === "organisation_create"
    );
    expect(tool?.inputSchema.properties).toHaveProperty("name");
  });

  it("returns a typed error as a tool error", async () => {
    const { body } = await rpc("tools/call", {
      name: "organisation_archive",
      arguments: { id: crypto.randomUUID() },
    });
    expect(body.result).toMatchObject({
      isError: true,
      content: [
        { type: "text", text: expect.stringMatching(/^permission: /u) },
      ],
    });
  });

  it("refuses a connection with no valid key", async () => {
    const { status } = await rpc("tools/list", undefined, "fx_wrong");
    expect(status).toBe(401);
  });
});
