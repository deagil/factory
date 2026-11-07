# @workspace/server

The Hono service: the HTTP API with OpenAPI and the MCP server, generated from the action registry.

**Status:** `createTransport({ registry, pipeline, callerFrom })` serves every definition as `POST /actions/<name>` or `/queries/<name>`, `/openapi.json`, and an MCP tool at `/mcp`. P1.14 and P1.15 finish the HTTP API and MCP server.

Design: [docs/SYSTEM_DESIGN.md](../../docs/SYSTEM_DESIGN.md), section 4.9 Surfaces, and decision [0026](../../docs/decisions/0026-api-transport-own-generator-on-hono.md).
