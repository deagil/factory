# 0024. How roles grant permissions

- **Status:** Superseded by [0045](0045-object-endpoints-and-workflows.md)
- **Date:** 2026-11-07

> **Superseded.** Role rules now cover endpoints (object endpoints and workflows by name), fields (read and write) and rows (`own` or `all`), applied in the data access layer on every surface. Still true: roles are config, actors hold them through `actor_roles`, an undefined role grants nothing, and permissions are loaded once per run.

## Context

SYSTEM_DESIGN section 4.3 gives roles as config: each permission names an object with verbs, or an action, and a scope (`all` only for now). The pipeline's authorise stage and the data access layer must both answer from them, and the data access layer's `canRead` hook is synchronous.

## Decision

- **Roles** are `{ key, label, permissions }`, validated by `roleSchema`. A permission is `{ object, can: [view | create | update | archive], scope }` or `{ action, scope }`. `*` stands for every object or every action. Roles reach the pipeline through `ConfigService.roles`; in phase 1 that's a static list, and phase 2 loads `config/roles/*.yaml` with the same schema.
- **Actors hold roles through `actor_roles`.** A role key that config doesn't define grants nothing, so removing a role from config takes its permissions away without touching data.
- **Generated definitions need an object permission**, which they carry as `objectPermission`: `.create`, `.update` and `.archive` need that verb, and `.get` and `.list` need `view`. **Hand-written actions and queries need a permission on their own name** (`{ action: "contact.moveToOrganisation" }`). Errors name what's missing as `<object>.<verb>` or the action name.
- **One load per run.** `permissions.load(actor)` reads the actor's roles once and returns a `Granted` with `authorise(definition)` and `canRead(object)`. The pipeline uses it for the authorise stage and gives `canRead` to the run's data access layer, so a hand-written query lists nothing of an object the actor can't view, and followed refs leave those records out.
- `allowAll` grants everything, for tests and tools that run as the system.

## Consequences

- Agents (never wider than their user) and integration actors (scoped to listed actions) are P1.12's; they plug into the same `load`.
- Scopes beyond `all` will make `canRead` return a condition rather than `"all"` or `"none"`, as decision 0017 planned.
