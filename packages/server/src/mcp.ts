// The MCP server (P1.15, decision 0026): one tool per action and query,
// generated from the registry, served statelessly over streamable HTTP at
// `/mcp`. An agent connects with its API key as the bearer token, so its
// calls run as the agent, for its user.
import {
  McpServer,
  WebStandardStreamableHTTPServerTransport,
} from "@modelcontextprotocol/server";
import type {
  CallToolResult,
  StandardSchemaWithJSON,
} from "@modelcontextprotocol/server";
import type {
  AnyDefinition,
  Caller,
  Pipeline,
  Registry,
} from "@workspace/actions";
import { z } from "zod";

import { callDefinition } from "./call.ts";

/**
 * A definition's tool name. Clients such as Claude only accept letters,
 * digits, `_` and `-` in tool names, and definition names have exactly one
 * dot and no underscores, so `organisation.create` is `organisation_create`.
 */
export const toolNameOf = (definition: AnyDefinition) =>
  definition.name.replace(".", "_");

const instructions = [
  "Each tool is an action (a change, permission-checked and logged) or a query (a read).",
  "Tool names are the action or query name with `_` for `.`; the title is the real name.",
  "A failed call returns an error result whose `error.code` is validation, permission, approval_required, conflict, not_found or internal.",
  "An action's result ends with its action id: quote it when you report what you did, and look it up with actionLog_get.",
].join(" ");

/**
 * The input schema as the SDK sees it: it advertises the JSON Schema but
 * accepts anything, so the pipeline alone validates input. If the SDK
 * validated, a bad call would get the SDK's error and no action_log row,
 * unlike the same call over HTTP (decision 0028; the contract tests check).
 */
const advertised = (
  schema: AnyDefinition["input"]
): StandardSchemaWithJSON<Record<string, unknown>> => ({
  "~standard": {
    ...(schema["~standard"] as StandardSchemaWithJSON<
      Record<string, unknown>
    >["~standard"]),
    validate: (value) => ({ value: (value ?? {}) as Record<string, unknown> }),
  },
});

type CallResult = Awaited<ReturnType<typeof callDefinition>>;

const actionIdOf = (result: CallResult): string | undefined =>
  "actionId" in result && typeof result.actionId === "string"
    ? result.actionId
    : undefined;

/** The action_log row a call wrote, for clients that keep `_meta`. */
const metaOf = (result: CallResult) => {
  const actionId = actionIdOf(result);
  return actionId ? { actionId } : {};
};

/**
 * The action id as a text block of its own, for clients that show the model
 * the text content. It is a separate block so the first stays the output,
 * or the error as JSON.
 */
const actionIdText = (result: CallResult) => {
  const actionId = actionIdOf(result);
  return actionId
    ? [{ type: "text" as const, text: `actionId: ${actionId}` }]
    : [];
};

const toolResult = (result: CallResult): CallToolResult => {
  if (!result.ok) {
    return {
      content: [
        {
          type: "text",
          text: `${result.error.code}: ${result.error.message}\n${JSON.stringify({ error: result.error })}`,
        },
        ...actionIdText(result),
      ],
      isError: true,
      _meta: metaOf(result),
    };
  }
  const output = result.output as Record<string, unknown>;
  const actionId = actionIdOf(result);
  return {
    content: [
      { type: "text", text: JSON.stringify(output) },
      ...actionIdText(result),
    ],
    // Claude Code shows the model `structuredContent` when there is one,
    // not the text or `_meta`, so an action's id goes in it too (P2.02).
    structuredContent: actionId ? { ...output, actionId } : output,
    _meta: metaOf(result),
  };
};

/**
 * An action's output schema with `actionId` added, since its structured
 * result carries one. Queries write no action_log row, so theirs is as is.
 */
const outputSchemaOf = (definition: AnyDefinition) =>
  definition.kind === "action" && definition.output instanceof z.ZodObject
    ? definition.output.extend({
        actionId: z.uuid().describe("The action_log row this call wrote."),
      })
    : definition.output;

/** One MCP server for one request, with a tool per definition. */
const mcpServerFor = (
  registry: Registry,
  pipeline: Pipeline,
  caller: Caller
) => {
  const server = new McpServer(
    { name: "factory", version: "0.0.0" },
    { instructions }
  );
  for (const definition of registry.list()) {
    const isQuery = definition.kind === "query";
    server.registerTool(
      toolNameOf(definition),
      {
        title: definition.name,
        description: definition.description,
        inputSchema: advertised(definition.input),
        outputSchema: outputSchemaOf(definition),
        annotations: {
          readOnlyHint: isQuery,
          destructiveHint: false,
          openWorldHint: false,
        },
      },
      async (input) =>
        toolResult(await callDefinition(pipeline, definition, input, caller))
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
