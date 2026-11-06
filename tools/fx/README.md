# @workspace/fx

The factory CLI and, later, its MCP server: changes (start, dev, switch, ship, status, release), introspection, scaffolding and checks.

Design: [docs/SYSTEM_DESIGN.md](../../docs/SYSTEM_DESIGN.md), sections 6. Delivery and 7. Agents.

## Using it

```bash
pnpm fx start "deal pipeline"   # branch, worktree, database and .env in one step
pnpm fx dev               # in the worktree: dev servers on the change's database
pnpm fx dev --reset       # rebuild the change's database from the schema first
pnpm fx ship              # rebase, write the one migration, run every check, push, open the PR
pnpm fx ship --contract-step "x is unused since #12"   # the migration is a contract step
pnpm fx switch refunds    # where another change's worktree is: cd "$(pnpm --silent fx switch refunds --path)"
pnpm fx done              # once merged: remove the worktree, branch, database and .fx entry
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
- `fx start "<name>"` slugs the name (`deal-pipeline`) and creates:
  - the branch `change/<slug>` from `origin/main` (fetched first), or from `main` if there is no remote;
  - the worktree `../<repo>.worktrees/<slug>`;
  - the database `<repo>_<slug>`, cloned from the migrated template that the tests also use;
  - the worktree's `.env`, a copy of the main checkout's with `DATABASE_URL` pointed at the change's database;
  - `pnpm install` in the worktree, then the entry in `.fx/`.

  It refuses a dirty working tree, or a name already taken by a state entry, branch, folder or database. If a step fails, it undoes the earlier ones.

- `fx dev` runs in a change's worktree. It prints which database it uses, then:
  - pushes the Drizzle schema to the change's database with `drizzle-kit push --force`. Data in a change database is disposable, and no migration files are written; `fx ship` writes the one migration;
  - runs the worktree's `turbo dev --ui=stream` with `DATABASE_URL` pointed at the change's database;
  - pushes again whenever a `.ts` file under `packages/db/src/schema` is saved (test files are ignored), one push at a time.

  A failed push is reported and the dev servers keep running; the next save tries again. drizzle-kit can't tell a rename from a drop and an add without asking, and it can't ask without a terminal. When it needs to, restart with `fx dev --reset`, which drops the database and rebuilds it, empty, from the schema.

  With `--json`, fx dev prints one JSON object per line (`started`, `schema_pushed`, `schema_push_failed`, `stopped`, each with `ok`), and the dev servers' output goes to stderr. Stop it with Ctrl-C or SIGTERM. fx dev passes SIGTERM on to the dev servers once, and kills them if they haven't stopped after 10 seconds.

- `fx ship` runs in a change's worktree, on its branch, with everything committed. In order, it:
  1. fetches `origin/main` and rebases the branch on it, after taking out the migration commit an earlier ship wrote. The person's commits come first and the migration commit always comes last, so main's new migrations never conflict with it;
  2. refuses if the branch edits `packages/db/migrations` itself: fx ship writes the change's one migration;
  3. runs `drizzle-kit generate --name <slug>` and commits the result as `chore: migration for <name>` with an `Fx-Migration: <slug>` trailer. That trailer is how the next ship finds the commit and replaces it. If the schema didn't change, there is no migration;
  4. runs the checks CI runs, stopping at the first that fails: the migration lint, typecheck, lint, tests, and the migrations on a fresh database (`pnpm db:check-migrations`). The result goes in the change's `lastCheck`;
  5. pushes with `--force-with-lease`, then opens a PR with `gh pr create --fill-first`, or finds the open one. Without `gh`, it prints the compare URL.

  `--contract-step "<why>"` makes the migration a contract step: it becomes the first line, `-- contract-step: <why>`, which the migration lint needs before it allows a destructive statement. Later ships keep it. If drizzle-kit would have to ask whether something was renamed, fx ship stops: renames aren't expand-safe, so add the new column in this change and drop the old one in a later contract step.

- `fx switch <name>` finds another change's worktree. A command can't change its shell's directory, so it prints the `cd`; `--path` prints only the path.
- `fx done [<name>]` (the current change if no name is given) checks that the branch is merged into `origin/main`. Merged means one of: its commits are in main's history; merging it into main changes nothing, which is how a squash merge looks; or `gh` knows of a merged PR from it. Then it removes the worktree, the local branch, origin's branch, the database and the `.fx` entry. Last, it drops template databases that neither the main checkout nor an open change uses, since tests rebuild them on demand. It refuses an unmerged change or uncommitted work unless given `--force`, which leaves origin's branch alone.

- fx loads the main checkout's `.env` for `DATABASE_ADMIN_URL`. The template helpers come from `@workspace/testing/databases`, which doesn't load Vitest.
