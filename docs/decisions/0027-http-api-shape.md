# 0027. The HTTP API's shape

- **Status:** Accepted
- **Date:** 2026-11-07

## Context

P1.14 turns the transport prototype (decision 0026) into the HTTP API the web app, integrations and generated SDKs use. They need fixed routes, one error shape, status codes they can branch on, retry keys and a way to trace a request.

## Decision

- **Routes:** `POST /actions/<name>` for every action; `POST` and `GET /queries/<name>` for every query. The body is the input; a `GET` takes it as JSON in `?input=` (default `{}`). `?dryRun=true` makes an action a dry run.
- **Success:** an action returns `{ output, actionId, replayed, dryRun, changes? }`; a query returns `{ output }`. Both are status 200.
- **Errors** are always `{ error: { code, message, ...details }, actionId, requestId }`. `actionId` is the `action_log` row, or null when none was written. Status codes by `code`:

  | code | status |
  | --- | --- |
  | `validation` (including a body that isn't JSON) | 400 |
  | `unauthenticated` | 401 |
  | `permission` | 403 |
  | `not_found` (including an unknown route) | 404 |
  | `conflict` | 409 |
  | `approval_required` | 202 (the action waits for sign-off) |
  | `internal` | 500 |

- **Callers:** `Authorization: Bearer fx_…` (an API key) or a Better Auth session, through `createAuth().callerFrom`. Better Auth's own routes are served under `/auth`.
- **Retry keys** come from the `Idempotency-Key` header (at most 255 characters); a repeat returns the first success with `replayed: true`.
- **Request IDs:** `X-Request-Id` is echoed back, or generated, on every response, and is in every error body.
- **OpenAPI** is served at `/openapi.json`. JSON Schema `$defs` (such as the recursive list filter) move to `components/schemas`, so every `$ref` resolves within the document.

## Consequences

- Clients branch on `error.code`; the status code is a convenience and agrees with it.
- The OpenAPI document is checked in tests for resolvable references and unique operation IDs. A full OpenAPI validator would need a new dependency; it isn't added yet.
- Rate limiting for integrations (decision 0025) belongs in this layer and is still to do.
