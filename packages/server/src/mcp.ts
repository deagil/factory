// MCP tools from the registry, served statelessly over streamable HTTP
// (decision 0026). P1.15 finishes the MCP server.
import {
  McpServer,
  WebStandardStreamableHTTPServerTransport,
} from "@modelcontextprotocol/server";
import type { Caller, Pipeline, Registry } from "@workspace/actions";

import { callDefinition } from "./call.ts";

/** One MCP server for one request, with a tool per definition. */
const mcpServerFor = (
  registry: Registry,
  pipeline: Pipeline,
  caller: Caller
) => {
  const server = new McpServer({ name: "factory", version: "0.0.0" });
  for (const definition of registry.list()) {
    server.registerTool(
      definition.name,
      { description: definition.description, inputSchema: definition.input },
      async (input) => {
        const result = await callDefinition(
          pipeline,
          definition,
          input,
          caller
        );
        const body = result.ok ? result.output : { error: result.error };
        return {
          content: [{ type: "text", text: JSON.stringify(body) }],
          structuredContent: body as Record<string, unknown>,
          isError: !result.ok,
        };
      }
    );
  }
  return server;
};

export const handleMcp = async (
  request: Request,
  registry: Registry,
  pipeline: Pipeline,
  caller: Caller
) => {
  const server = mcpServerFor(registry, pipeline, caller);
  const transport = new WebStandardStreamableHTTPServerTransport({
    enableJsonResponse: true,
  });
  await server.connect(transport);
  return transport.handleRequest(request);
};
