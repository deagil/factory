# @workspace/fx

The factory CLI and, later, its MCP server: changes (start, dev, switch, ship, status, release), introspection, scaffolding and checks.

Design: [docs/SYSTEM_DESIGN.md](../../docs/SYSTEM_DESIGN.md), sections 6. Delivery and 7. Agents.

## Using it

```bash
pnpm fx start "deal pipeline"   # branch, worktree, database and .env in one step
pnpm fx dev               # in the worktree: dev servers on the change's database
pnpm fx dev --reset       # rebuild the change's database from the schema first
pnpm fx ship              # rebase, write the one migration, run every check, push, refresh the PR, wait for GitHub's check
pnpm fx ship --contract-step "x is unused since #12"   # the migration is a contract step
pnpm fx switch refunds    # where another change's worktree is: cd "$(pnpm --silent fx switch refunds --path)"
pnpm fx done              # once merged: remove the worktree, branch, database and .fx entry, then fast-forward a clean main
pnpm fx status            # the current change, its branch, database, last local checks, and GitHub's check
pnpm fx status --json     # the same, as JSON on stdout, for agents
pnpm fx describe          # the system's objects, actions, queries and events
pnpm fx describe contact.moveToOrganisation   # one action, with its input and output schemas
pnpm fx --help
```

- **Every command takes `--json`.** Success prints `{ "ok": true, ... }`, and failure prints `{ "ok": false, "error": { "code", "message", "hint" } }`. Both go to stdout; pnpm's own banner goes to stderr.
- **Exit codes:** 0 on success, 1 on failure, 2 on a usage error.
- **Error codes** agents can branch on are listed in `src/errors.ts`.

## How it works

- Node 26 runs `src/cli.ts` directly, with no build step. Arguments are parsed with `node:util`'s `parseArgs`, and fx has no dependencies.
- The state of open changes lives in `.fx/changes/<slug>.json` in the main checkout (gitignored). Each file holds the change's name, slug, branch, worktree, database and last check result. Commands run from a worktree find it through `git rev-parse --git-common-dir`.
- The current change is the one whose worktree contains the directory fx runs from.
- `fx start "<name>"` slugs the name (`deal-pipeline`) and creates:
  - the branch `change/<slug>` from `origin/main` (fetched first), or from `main` if there is no remote;
  - the worktree `../<repo>.worktrees/<slug>`;
  - the database `<repo>_<slug>`, cloned from the migrated template that the tests also use;
  - the worktree's `.env`, a copy of the main checkout's with `DATABASE_URL` pointed at the change's database;
  - `pnpm install` in the worktree, then the entry in `.fx/`.

  It refuses a dirty working tree and names the files. Stash them on that checkout and pop the stash there after `fx start`: the worktree is created from the commit, so the stash is not in it. It also refuses a name already taken by a state entry, branch, folder or database. If a step fails, it undoes the earlier ones.

- `fx dev` runs in a change's worktree. It prints which database it uses, then:
  - pushes the Drizzle schema to the change's database with `drizzle-kit push --force`. Data in a change database is disposable, and no migration files are written; `fx ship` writes the one migration;
  - runs the worktree's `turbo run dev db:studio --ui=stream` (the dev servers and Drizzle Studio) with `DATABASE_URL` pointed at the change's database;
  - pushes again whenever a `.ts` file under `packages/db/src/schema` is saved (test files are ignored), one push at a time.

  A failed push is reported and the dev servers keep running; the next save tries again. drizzle-kit can't tell a rename from a drop and an add without asking, and it can't ask without a terminal. When it needs to, restart with `fx dev --reset`, which drops the database and rebuilds it, empty, from the schema.

  With `--json`, fx dev prints one JSON object per line (`started`, `schema_pushed`, `schema_push_failed`, `stopped`, each with `ok`), and the dev servers' output goes to stderr. Stop it with Ctrl-C or SIGTERM. fx dev passes SIGTERM on to the dev servers once, and kills them if they haven't stopped after 10 seconds.

- `fx ship` runs in a change's worktree, on its branch, with everything committed. In order, it:
  1. fetches `origin/main` and rebases the branch on it, after taking out the migration commit an earlier ship wrote. The person's commits come first and the migration commit always comes last, so main's new migrations never conflict with it;
  2. refuses if the branch edits `packages/db/migrations` or a system's `migrations` folder itself: fx ship writes the change's migrations;
  3. runs `drizzle-kit generate --name <slug>` in `packages/db` and in each system package with a `drizzle.config.ts` (decision 0036), and commits what they write as `chore: migration for <name>` with an `Fx-Migration: <slug>` trailer. That trailer is how the next ship finds the commit and replaces it. Each schema that didn't change gets no migration;
  4. runs the checks CI runs, stopping at the first that fails: the migration lint, typecheck, lint, tests, config (`pnpm config:validate`), and the migrations on a fresh database (`pnpm db:check-migrations`). The result goes in the change's `lastCheck`. A green result here is the local run, not GitHub's `check`;
  5. pushes with `--force-with-lease` against the remote commit this checkout last saw (an absent branch must still be absent), so a remote that moved is left alone, then opens a PR, or updates the open one. The title is the first commit's subject, which a squash onto main keeps, so that commit has to describe the whole change. The body is every commit on the branch, and a later ship refreshes it. Without `gh`, it prints the compare URL;
  6. waits for GitHub's `check` and prints its failing log. `fx status` shows the same check: pending, passed or failed. Merge only after it is green.

  Turbo's cache is shared between worktrees. A check whose inputs haven't changed replays its earlier output, including paths in the worktree that first ran it, even if that worktree is gone.

  `--contract-step "<why>"` makes the migration a contract step: it becomes the first line, `-- contract-step: <why>`, which the migration lint needs before it allows a destructive statement. Later ships keep it. If drizzle-kit would have to ask whether something was renamed, fx ship stops: renames aren't expand-safe, so add the new column in this change and drop the old one in a later contract step.

- `fx describe [<name>]` imports the system file and prints `system.describe()`, which shows everything, as an admin would see it. It needs no database. A package declares its system in its package.json, `"factory": { "system": "./src/system.ts" }`, and the file's default export is the `defineSystem` result. With more than one system in the repo, pick one with `--system <dir>`. `<name>` narrows the output to an object (with its actions, queries and events) or to one action, query or event, shown with its JSON Schemas. Each action shows its kind (`internal` or `external`), and a Step actions section lists what workflow steps run, which no surface reaches. `--json` prints the whole description.

- `fx switch <name>` finds another change's worktree. A command can't change its shell's directory, so it prints the `cd`; `--path` prints only the path.
- `fx done [<name>]` (the current change if no name is given) checks that the branch is merged into `origin/main`. Merged means one of: its tip is in main's history; merging it into main changes nothing, which is how a squash merge looks; or `gh` knows of a merged pull request whose head commit is that tip. A merged pull request for an older commit does not count. Then it removes the worktree, the local branch, origin's branch, the database and the `.fx` entry. Origin's branch is deleted with `--force-with-lease` on the verified tip, so commits that showed up after the check are left in place. Run it from the main checkout. When that checkout is on `main` and clean, it fast-forwards to `origin/main` and runs `pnpm install` if `pnpm-lock.yaml` changed. A dirty checkout is left as it is, with the files named. Last, it drops this checkout's template databases that neither the main checkout nor an open change uses. Another checkout's templates are left alone; tests rebuild a missing template on demand. It refuses an unmerged change or uncommitted work unless given `--force`, which leaves origin's branch alone.

- fx loads the main checkout's `.env` for `DATABASE_ADMIN_URL`. The template helpers come from `@workspace/testing/databases`, which doesn't load Vitest.
