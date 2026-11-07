# 0028. MCP tools

- **Status:** Accepted
- **Date:** 2026-11-07

## Context

P1.15 serves every action and query as an MCP tool (decision 0026). Agents such as Claude Code connect with an agent's API key. Definition names have a dot (`organisation.create`), but Claude's tool names allow only letters, digits, `_` and `-`.

## Decision

- **Tool names** are the definition name with `_` for the dot (`organisation_create`). Names have exactly one dot and no underscores, so the mapping is one to one. The tool's `title` is the real name.
- **Each tool** carries the definition's description, input schema and output schema. Queries are marked `readOnlyHint: true`; no tool is marked destructive, since archiving is reversible.
- **Results:** a success returns the output as `structuredContent` and as JSON text. A typed error returns `isError: true` with the text `<code>: <message>` and the error as JSON, so the model sees why.
- **Sessions:** none. Each request builds a server for its caller, so tool calls need no `initialize` first, and any instance can serve any request.
- **Callers** are checked by the HTTP API before MCP sees the request; an invalid key gets the API's 401.
- The server's `instructions` explain actions, queries, tool names and error codes.

## Consequences

- Tools are listed whether or not the caller may use them; a forbidden call returns a `permission` tool error. Filtering the list by permission can follow `system.describe` (P1.16).
- MCP calls have no retry key yet.
