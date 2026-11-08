# @workspace/config

Config schemas, validateConfig, the git config service, the config loader and staff drafts.

**Status:** config types and reading `config/` are built (P2.03); validateConfig, the loader and drafts follow in phase 2.

- Config is plain YAML 1.2 at `config/<type>/<key>.yaml`, and the `key` in a file matches its name (decision 0037).
- `defineConfigType({ type, schema, references })` registers a type: its folder, its Zod schema, and what each file points to (objects, actions and so on), with the path to each.
- `readConfig(dir, types)` returns the valid files and every problem, each naming the file, the path in it, the line and what's wrong. `loadConfig` throws a `ConfigError` instead. `valuesOf(files, type)` picks one type's values.
- `roleConfigType` is the first type; `coreConfigTypes` lists the core's.

Design: [docs/SYSTEM_DESIGN.md](../../docs/SYSTEM_DESIGN.md), section 4.4 Config.
