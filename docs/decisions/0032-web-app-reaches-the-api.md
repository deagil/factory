# 0032. How the web app reaches the API

- **Status:** Accepted
- **Date:** 2026-11-07

## Context

The web app is just another client of the HTTP API (AGENTS.md rule 6). It runs on its own port (3000) beside the system's server (4000 for the CRM) and signs staff in with Better Auth's session cookie. A cookie set by another origin needs CORS and `SameSite=None`, which is fiddly and easy to get wrong.

## Decision

- **TanStack Start runs in SPA mode.** No server rendering, server functions or loaders that reach the server; the browser does everything.
- **The web app's dev server proxies** `/api/*` to the system's server with the `/api` prefix removed, and `/auth/*` unchanged (`API_URL`, default `http://localhost:4000`). The browser only talks to its own origin, so the session cookie is first-party. A deployed web app does the same with its host's proxy or rewrite rules.
- **Better Auth's `baseURL` is the web app's origin** (`BETTER_AUTH_URL`, default `http://localhost:3000`), since that is where sign-in happens.
- **The API client** (`apps/web/src/lib/api.ts`) has `runAction`, `runQuery` and `describeSystem`. It throws `ApiCallError` carrying the typed error (decision 0027). Types come from `@workspace/actions` and `@workspace/server` as type-only imports.
- **Sign-in** calls Better Auth's email-code endpoints directly with `fetch`; no Better Auth client library.
- **Navigation** is built from `system.describe` (decision 0029): one entry per object the caller can view.
- **Data** goes through TanStack Query. The signed-in layout loads the session in `beforeLoad` and redirects to `/sign-in` without one.

## Consequences

- The web app needs no CORS settings on the server.
- The API is at `/api/...` from the browser but at `/...` on the server; the proxy is the only place that knows.
- UI primitives (`Input`, `Label`, `Card`) were written by hand in `packages/ui` in shadcn's style rather than added with the shadcn CLI.
