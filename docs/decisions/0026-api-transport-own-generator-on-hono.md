# 0026. API transport: our own generator on Hono

- **Status:** Accepted
- **Date:** 2026-11-07

## Context

SYSTEM_DESIGN left the API transport open: our own generator on Hono, or oRPC. P1.13 built both for the generated `organisation` actions: HTTP routes, an OpenAPI document and, for the generator, an MCP tool per definition.

What the oRPC spike showed:

- **It validates before the pipeline.** Giving oRPC the definition's input schema means a bad input is refused by oRPC, so it never reaches the pipeline. The pipeline's `validation` error, its `failed` log row and our error shape are skipped. Not giving oRPC the schema loses its OpenAPI document.
- **It has its own error envelope** (`{ defined, code, status, message, data }`), so every typed error is wrapped in `ORPCError` and the shape we document is oRPC's, not ours.
- **Its router types expect a literal object.** The registry is built at runtime, so the router and the generator both needed casts.
- **It has no MCP.** The MCP tools are the same `McpServer` code either way.
- **It adds three dependencies** (`@orpc/server`, `@orpc/openapi`, `@orpc/zod`).

oRPC's route code was shorter (about 55 lines against about 100 without MCP), because it writes the OpenAPI document for us. Writing it ourselves is one `z.toJSONSchema` call per input and output.

## Decision

- **We generate the transport ourselves on Hono** in `@workspace/server`. Each definition in the registry becomes a route (`POST /actions/<name>`, `/queries/<name>`), an OpenAPI operation built with `z.toJSONSchema`, and an MCP tool registered with the official SDK's `McpServer`.
- **The pipeline is the only place input is validated**, so every surface gets the same errors and the same log rows.
- **MCP runs statelessly**: one `McpServer` and one `WebStandardStreamableHTTPServerTransport` per request, built for that request's caller, over Hono's web-standard request.
- **Callers** come from `callerFrom(headers)`, which P1.14 wires to `createAuth`.

## Consequences

- We own the OpenAPI document and its error shape; P1.14 adds status codes, request IDs, retry keys and `GET` for queries.
- One code path from definition to every surface makes P1.17's contract tests straightforward.
- A per-request MCP server costs a registration loop on each call; if that shows up in profiles, cache the tool list per actor.
