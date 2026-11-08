# @workspace/config

Config schemas, validateConfig, the git config service, the config loader and staff drafts.

**Status:** config types, reading `config/`, `validateConfig`, the loader and choice lists are built (P2.03 to P2.06); the git config service and drafts follow in phase 2.

- Config is plain YAML 1.2 at `config/<type>/<key>.yaml`, and the `key` in a file matches its name (decision 0037).
- `defineConfigType({ type, schema, references })` registers a type: its folder, its Zod schema, and what each file points to (objects, actions and so on), with the path to each.
- `readConfig(dir, types)` returns the valid files and every problem, each naming the file, the path in it, the line and what's wrong. `loadConfig` throws a `ConfigError` instead. `valuesOf(files, type)` picks one type's values.
- `validateConfig(dir, types, catalog)` reads the files, then checks each file's references against a `ConfigCatalog` of the running system's objects and fields, hand-written actions and queries, generated ones, and events. A role that names a generated action is told to grant it as an object permission. `@workspace/server` builds the catalog: a system with `config` has `system.validateConfig()` and the `config.validate` query, and `pnpm config:validate` runs it for every system, in `fx ship` and CI.
- `createConfigLoader({ dir, types, catalog, record })` loads `config/`, refuses invalid versions and keeps the last good one, records each version tried (`config_versions`), and backs `ConfigService`. `watch()` reloads on save (decision 0038).
- `choiceConfigType` reads `config/choices/<list>.yaml`. `validateConfig` holds each list to the control of the fields that use it (system: exactly the code's keys, none archived; mapped: each option in one of the code's categories; custom: anything), and config refers to an option as `list.option`, which must not be archived. The loader's `choices(list)` gives the live options, which the repository checks choice values against (decision 0039).
- `roleConfigType` and `choiceConfigType` are the core's types; `coreConfigTypes` lists them.

Design: [docs/SYSTEM_DESIGN.md](../../docs/SYSTEM_DESIGN.md), section 4.4 Config.
