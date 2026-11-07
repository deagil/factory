import {
  McpServer,
  WebStandardStreamableHTTPServerTransport,
} from "@modelcontextprotocol/server";
// The transport prototype (P1.13, decision 0026): our own generator on Hono.
// Every registered action and query becomes an HTTP route, an OpenAPI
// operation and an MCP tool, all from the same definition. P1.14 and P1.15
// grow this into the full HTTP API and MCP server.
import type {
  AnyDefinition,
  Caller,
  Pipeline,
  Registry,
} from "@workspace/actions";
import { Hono } from "hono";
import { z } from "zod";

export interface TransportOptions {
  registry: Registry;
  pipeline: Pipeline;
  /** Finds the caller from a session cookie or an API key. */
  callerFrom: (headers: Headers) => Promise<Caller | null>;
}

const callOne = (
  pipeline: Pipeline,
  definition: AnyDefinition,
  input: unknown,
  caller: Caller
) =>
  definition.kind === "action"
    ? pipeline.run(definition, input, caller)
    : pipeline.query(definition, input, caller);

const pathOf = (definition: AnyDefinition) =>
  `/${definition.kind === "action" ? "actions" : "queries"}/${definition.name}`;

/** The OpenAPI 3.1 document for every definition in the registry. */
export const openApiDocument = (registry: Registry) => ({
  openapi: "3.1.0",
  info: { title: "factory", version: "0.0.0" },
  paths: Object.fromEntries(
    registry.list().map((definition) => [
      pathOf(definition),
      {
        post: {
          operationId: definition.name,
          description: definition.description,
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: z.toJSONSchema(definition.input, { io: "input" }),
              },
            },
          },
          responses: {
            "200": {
              description: "The definition's output.",
              content: {
                "application/json": {
                  schema: z.toJSONSchema(definition.output),
                },
              },
            },
          },
        },
      },
    ])
  ),
});

/** One MCP server for one request, with a tool per definition. */
const mcpServerFor = (
  { registry, pipeline }: TransportOptions,
  caller: Caller
) => {
  const server = new McpServer({ name: "factory", version: "0.0.0" });
  for (const definition of registry.list()) {
    server.registerTool(
      definition.name,
      { description: definition.description, inputSchema: definition.input },
      async (input) => {
        const result = await callOne(pipeline, definition, input, caller);
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

export const createTransport = (options: TransportOptions) => {
  const app = new Hono<{ Variables: { caller: Caller } }>();

  app.get("/openapi.json", (c) => c.json(openApiDocument(options.registry)));

  app.use("*", async (c, next) => {
    const caller = await options.callerFrom(c.req.raw.headers);
    if (!caller) {
      return c.json({ error: { code: "unauthenticated" } }, 401);
    }
    c.set("caller", caller);
    return next();
  });

  for (const definition of options.registry.list()) {
    app.post(pathOf(definition), async (c) => {
      const input: unknown = await c.req.json();
      const result = await callOne(
        options.pipeline,
        definition,
        input,
        c.get("caller")
      );
      return result.ok ? c.json(result) : c.json(result, 400);
    });
  }

  app.all("/mcp", async (c) => {
    const server = mcpServerFor(options, c.get("caller"));
    const transport = new WebStandardStreamableHTTPServerTransport({
      enableJsonResponse: true,
    });
    await server.connect(transport);
    return transport.handleRequest(c.req.raw);
  });

  return app;
};
