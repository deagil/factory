# @workspace/server

The Hono service: the HTTP API with OpenAPI and the MCP server, generated from the action registry.

**Status:** `createApi({ registry, pipeline, callerFrom, authHandler })` serves every action at `POST /actions/<name>`, every query at `POST`/`GET /queries/<name>`, the OpenAPI document at `/openapi.json`, Better Auth under `/auth` and MCP tools at `/mcp`. Routes, errors, retry keys and request IDs are in decision [0027](../../docs/decisions/0027-http-api-shape.md). P1.15 finishes the MCP server.

Design: [docs/SYSTEM_DESIGN.md](../../docs/SYSTEM_DESIGN.md), section 4.9 Surfaces, and decision [0026](../../docs/decisions/0026-api-transport-own-generator-on-hono.md).
