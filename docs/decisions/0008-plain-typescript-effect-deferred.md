# 0008. Plain TypeScript; Effect deferred

- **Status:** Accepted
- **Date:** 2026-11-06

## Context

Effect 4.0 (released September 2026) offers typed errors, dependency injection, retries, tracing, HttpApi with OpenAPI, an MCP server, SQL and durable workflows in one model, and integrates with Drizzle and Better Auth.

## Decision

Use plain TypeScript with Hono, Zod 4, Drizzle, DBOS and the official MCP SDK. Do not adopt Effect now, because the modules we would rely on (HTTP, HttpApi, SQL, RPC, workflow, cluster, AI, observability) are marked unstable in 4.0; its workflows are less mature than DBOS; agents need its source vendored to write correct v4 code; and client developers would have to learn it at handover. Write code with Effect-shaped seams: typed error results, services through the action context, one owner for retries and tracing.

## Consequences

- Trial after phase 1: rebuild the action pipeline, one route, one MCP tool and one workflow in Effect 4 and compare agent first-time success, lines of code, newcomer readability and unstable APIs touched.
- Revisit when HttpApi, SQL and workflow become stable, when models write correct Effect 4 unaided, or when the pipeline sprawls. If adopted, Effect lives inside the core only.
