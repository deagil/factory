# @workspace/config

Config schemas, validateConfig, the git config service, the config loader and staff drafts.

**Status:** config types, reading `config/`, `validateConfig`, the loader, choice lists, the git config service and drafts are built (P2.03 to P2.08). Approval rules for drafts follow in P2.09.

- Config is plain YAML 1.2 at `config/<type>/<key>.yaml`, and the `key` in a file matches its name (decision 0037).
- `defineConfigType({ type, schema, references })` registers a type: its folder, its Zod schema, and what each file points to (objects, actions and so on), with the path to each.
- `readConfig(dir, types)` returns the valid files and every problem, each naming the file, the path in it, the line and what's wrong. `loadConfig` throws a `ConfigError` instead. `valuesOf(files, type)` picks one type's values.
- `validateConfig(dir, types, catalog)` reads the files, then checks each file's references against a `ConfigCatalog` of the running system's objects and fields, hand-written actions and queries, generated ones, and events. A role that names a generated action is told to grant it as an object permission. `@workspace/server` builds the catalog: a system with `config` has `system.validateConfig()` and the `config.validate` query, and `pnpm config:validate` runs it for every system, in `fx ship` and CI.
- `createConfigLoader({ dir, types, catalog, record })` loads `config/`, refuses invalid versions and keeps the last good one, records each version tried (`config_versions`), and backs `ConfigService`. `watch()` reloads on save (decision 0038).
- `choiceConfigType` reads `config/choices/<list>.yaml`: the rows of a list whose structure is defined in code with `defineChoiceList`. `validateConfig` checks each row against its list's columns (the built-in key, label, description and archived, and the list's own) and a list with fixed keys to exactly those, none archived. Config refers to an option as `list.option`, which must not be archived. The loader's `choices(list)` gives the live options, which the repository checks choice values against (decisions 0039, 0040).
- `createGitConfigService({ remote, cacheDir, types, catalog, onPublished })` works on any git remote with plain git: a bare clone as a cache, and commits made with plumbing. It is the `GitService` actions see as `ctx.git`, and its `source` lets the loader read production's head commit instead of the working tree (decision 0041).
- The draft actions `draft.open`, `draft.save`, `draft.submit` and `draft.publish`, and the queries `draft.list` and `draft.get`, are in `drafts.ts`; every system with `config` has them. A draft is a branch from production, one commit per saved file, checked on every save; publishing lays its files on production as one commit and copies them to `main`.
- `roleConfigType` and `choiceConfigType` are the core's types; `coreConfigTypes` lists them.

Design: [docs/SYSTEM_DESIGN.md](../../docs/SYSTEM_DESIGN.md), section 4.4 Config.
