# 0019. `defineAction`, the handler context and typed errors

- **Status:** Accepted
- **Date:** 2026-11-07

## Context

Every surface is generated from the action registry (decision 0001), so the shape of a definition becomes the shape of the HTTP API, the MCP tools and the web forms. The design names the parts (`ctx` with `repo`, `dal`, `config`, `clock`, `actor`, `emit` and error helpers; typed errors; events declared on actions) but not how they fit together, how handlers report failures, or how "handlers can't reach services except through `ctx`" is enforced.

## Decision

- **Definitions.** `defineAction({ name, description, input, output, emits?, handler })` and `defineQuery` (the same, without `emits`) return frozen definitions with a `kind`. Names, and event names, are `<object>.<word>` in camelCase. A description is required, since surfaces and agents show it. `input` and `output` are Zod objects, so every surface can carry them as JSON.
- **Events are typed through `emits`.** `ctx.emit(type, payload)` only accepts a type the action declares, with a payload that fits its schema; anything else fails type-checking. At run time an undeclared type or a payload that doesn't fit throws, since either is a bug, not an expected failure.
- **`ctx` is built per run**, by `createActionContext(action, services)` and `createQueryContext(services)`, inside the run's transaction once its `action_log` row exists (P1.07). Actions get `repo`, `dal`, `config`, `clock`, `actor`, `originUserId`, `emit` and the error helpers. Queries get the same without `repo` and `emit`, so a query can't write. The context is frozen. `createActionContext` also returns the events emitted so far, for the record stage.
- **`ConfigService` is defined in `@workspace/actions`**, because `config` depends on `actions` (AGENTS.md rule 9). In phase 1 it holds only `sha` (always null); P1.11 adds roles.
- **Typed errors are returned, not thrown.** The helpers (`invalid`, `invalidInput`, `forbidden`, `needsApproval`, `conflict`, `notFound`) return an `ActionFailure`: a frozen value with a private brand and a plain-JSON `error`, `{ code, message, … }`. The codes are `validation` (with `issues`), `permission` (with the missing `permission`), `approval_required` (with the `rule`), `conflict` and `not_found` (with `object` and `id`). The brand means an output that happens to look like an error is never taken for one. The pipeline should treat a thrown `ActionFailure` the same as a returned one, so a helper deep in a call can fail the action; anything else thrown is an unexpected error.
- **Handlers may return a value or a promise.**
- **The registry** is built from a list, `createRegistry([...definitions])`, rather than filled as files load. Actions and queries share one namespace, so two definitions with the same name fail whatever their kinds; MCP tools and the OpenAPI document would clash otherwise. An event declared by several actions must use the same schema object in each, so the registry can list each event with one schema.
- **The `ctx`-only rule is checked from the source.** A file that calls `defineAction` or `defineQuery` may not import `@workspace/db`, `@workspace/config`, `@workspace/auth`, `@workspace/server`, `drizzle-orm` or `pg` (subpaths included), may not use `createRepository`, `createDataAccess`, `createDb` or `withTransaction`, and may not read the system clock (`Date.now()`, `new Date()`). `checkHandlerBoundary(dirs)` in `@workspace/actions/boundary` finds them; the core runs it over its own source in a test, and systems run it in CI (P1.18). Test files are skipped, since tests set up databases around the handlers they define. The types already give handlers nothing but `ctx`; the check closes the import route.

## Consequences

- P1.07's pipeline creates the services, calls `createActionContext`, runs the handler and checks `isActionFailure` on what comes back (or is thrown).
- Surfaces map error codes to their own shapes: `actionErrorCodes` lists them all for P1.14.
- The boundary check is text-based. It ignores comments but not strings, so a string that spells a forbidden call would be reported; that is rare in handler files and easy to reword.
- Hand-written action files must be separate from object files when the object needs `drizzle-orm` for its indexes.
