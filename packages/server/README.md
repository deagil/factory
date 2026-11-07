# @workspace/server

The Hono service: the HTTP API with OpenAPI and the MCP server, generated from the action registry.

**Status:** `defineSystem({ name, objects, actions, roles })` builds a system's registry and `createServer(system, options)` checks the schema and runs it (decision [0031](../../docs/decisions/0031-define-system-and-create-server.md)).

Under it, `createApi({ registry, pipeline, callerFrom, authHandler })` serves every action at `POST /actions/<name>`, every query at `POST`/`GET /queries/<name>`, the OpenAPI document at `/openapi.json`, Better Auth under `/auth` and MCP tools at `/mcp`. Routes, errors, retry keys and request IDs are in decision [0027](../../docs/decisions/0027-http-api-shape.md). MCP tools are in decision [0028](../../docs/decisions/0028-mcp-tools.md): `organisation_create` for `organisation.create`, typed errors as tool errors, and an agent's API key as the bearer token.

`@workspace/server/testing` has `runContract`, which runs every action over HTTP and MCP and reports any difference in results or log rows (decision [0030](../../docs/decisions/0030-contract-tests-across-surfaces.md)).

Design: [docs/SYSTEM_DESIGN.md](../../docs/SYSTEM_DESIGN.md), section 4.9 Surfaces, and decision [0026](../../docs/decisions/0026-api-transport-own-generator-on-hono.md).
