# @workspace/fx

The factory CLI and, later, its MCP server: changes (start, dev, switch, ship, status, release), introspection, scaffolding and checks.

Design: [docs/SYSTEM_DESIGN.md](../../docs/SYSTEM_DESIGN.md), sections 6. Delivery and 7. Agents.

## Using it

```bash
pnpm fx status            # the current change, its branch, database and last checks
pnpm fx status --json     # the same, as JSON on stdout, for agents
pnpm fx --help
```

- **Every command takes `--json`.** Success prints `{ "ok": true, ... }`, and failure prints `{ "ok": false, "error": { "code", "message", "hint" } }`. Both go to stdout; pnpm's own banner goes to stderr.
- **Exit codes:** 0 on success, 1 on failure, 2 on a usage error.
- **Error codes** agents can branch on are listed in `src/errors.ts`.

## How it works

- Node 24 runs `src/cli.ts` directly, with no build step. Arguments are parsed with `node:util`'s `parseArgs`, and fx has no dependencies.
- The state of open changes lives in `.fx/changes/<slug>.json` in the main checkout (gitignored). Each file holds the change's name, slug, branch, worktree, database and last check result. Commands run from a worktree find it through `git rev-parse --git-common-dir`.
- The current change is the one whose worktree contains the directory fx runs from.
