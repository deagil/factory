# 0037. Config files are YAML, one per key

- **Status:** Accepted
- **Date:** 2026-11-08

## Context

Config is files in git (SYSTEM_DESIGN §4.4), edited by developers, agents and, through drafts, staff. Phase 1 left the format open between YAML and JSON. The files are read by people in diffs and approval screens as much as by code, and they hold lists of permissions, choice options and workflow steps.

## Decision

- **Config files are YAML 1.2**, parsed with the `yaml` package's `core` schema, at `config/<type>/<key>.yaml`. `.yaml` is the only extension. YAML 1.2 reads `no`, `on` and `yes` as strings, so a choice key `no` stays `no`.
- **Plain YAML only:** one document per file, no duplicate keys, no anchors or aliases, and no tags. Each file says everything it means, so a diff of one file shows the whole change. A file that breaks this fails to load, and the problem names the file and line.
- **The key in the file matches its name.** `config/roles/sales.yaml` holds `key: sales`. Renaming a file without changing the key, or the reverse, is an error.
- **`defineConfigType({ type, schema, references })`** registers a type: `type` is its folder under `config/`, `schema` is a Zod schema whose output has a string `key`, and `references(value)` lists what the file points to (objects, actions, fields and so on) with the path to each, for `validateConfig` (P2.04) to check against the running code.
- **`readConfig(dir, types)`** reads every type's files and returns them with any problems: the file, the path in it, the line and a plain-English message. `loadConfig` does the same and throws if there are problems.
- **Roles are the first config type,** `roleConfigType`, registered by `@workspace/config` from the role schema in `@workspace/actions`.

## Consequences

- JSON was simpler to parse but harder to read and comment in a diff; YAML costs one dependency, `yaml`, which has no dependencies of its own and keeps source positions for error messages.
- The CRM's roles move from `src/roles.ts` to `examples/crm/config/roles/`. `defineSystem` still takes roles until the loader (P2.05) owns them.
- A config type must have a `key` field. Types with nested folders, such as email templates, are decided when they are built.
