# 0001. One action registry, many surfaces

- **Status:** Accepted
- **Date:** 2026-11-06

## Context

Clients reach a system through a web front end, external agents, the in-app agent, scripts and other systems. In earlier projects (splx) each channel grew its own write paths, which made permissions, audit and agent parity hard to guarantee.

## Decision

Every capability is a typed action or query, defined once with `defineAction` or `defineQuery` and registered in one registry. The HTTP API, MCP server, CLI, web surface and in-app agent are generated from the registry. Every action runs through one pipeline: identify, validate, retry check, authorise, approve, run, record, commit. The in-app agent has no powers an external agent with the same permissions lacks.

## Consequences

- Permissions, validation, history and events always apply, whoever calls.
- Agents and people are equal clients; there is nothing hidden in the product.
- Writing data outside an action is a bug, which CI and review must catch.
