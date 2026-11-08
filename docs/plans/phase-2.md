# Phase 2: Config over git

**Goal:** staff change how a system behaves without a deploy. Choice fields, roles, approval rules, workflows and email templates are files under `config/`, validated against the running code. Staff edit them in drafts that publish as one git commit, and the running system loads them within seconds. Workflows react to events and run actions durably, as themselves. At the end, a sales manager adds a deal stage and an email for it in one draft, publishes it, and the next deal moved to that stage sends the email, with every step in history.

**Out of scope:**

- Hosting, releases to `production` from a real remote, the release bot and client SSO (phase 3). Phase 2 publishes to a `production` branch of a local or test remote.
- Scoped permissions beyond `all`, the page builder, reports and the in-app agent (later).
- Payments, documents and other modules beyond comms (later).

## Resume here

- **Status:** in progress. P2.01 to P2.07 are done: systems have their own migrations (decision 0036), agents see action ids, and config is YAML files with registered types (decision 0037), checked by `validateConfig` in `fx ship` and CI, and loaded live by the config loader (decision 0038). `f.choice` checks values against `config/choices/`, and each list's columns and any fixed keys are defined in code with `defineChoiceList` (decisions 0039, 0040). The CRM has organisations, contacts and deals; `deal.stage` is a mapped choice, a deal starts in an open stage, and `deal.moveStage` is the only way to change it. The web app shows choice fields as selects and refs to actors as a picker. [Phase 1b](phase-1b.md)'s screens are where this phase's approvals inbox, config editors and run inspector go.
- **Next task:** P2.08, drafts over git. It adds the git source to the loader. P2.09 (approval rules) and P2.11 (workflow definitions) are also unblocked; their conditions can test a choice field's column, such as `stage.category` (decision 0040). P2.10 needs P2.08 and P2.09 as well as P2.07.
- **How to start:** see [docs/plans/README.md](README.md) and AGENTS.md. Every change goes through `pnpm fx start` → `pnpm fx ship` → `pnpm fx done`. `pnpm fx describe` shows what the CRM has.
- **Carried over from phase 1:**
  - drizzle-kit can't tell a rename from a drop and an add without a terminal, and 0.31 re-adds `actor_roles`' primary key on every push. See [phase-1-handover.md](phase-1-handover.md) for these and the other traps.

## Decisions for this phase

These fill gaps until later phases replace them. Don't build further than this.

- **The config remote is any git remote.** Tests and local development use a bare repository on disk; phase 3 points it at the client's real remote. The config service uses plain git commands, not a GitHub API.
- **Locally, `config/` is read from the working tree** and reloaded on save, with no git involved, as SYSTEM_DESIGN 4.4 says. Drafts are exercised against a bare test remote.
- **The bot that copies a publish from `production` back to `main` is a function the config service calls after the merge,** not a separate service. Phase 3 moves it to wherever releases run.
- **Email goes to a dev sink locally:** `comms.send` prints the message to the server console, the same way sign-in codes are printed. A real provider comes with hosting.
- **Workflows run in the API process** with DBOS on the same Postgres. A separate worker is a phase 3 question.

## Tasks

### Carry-overs

- [x] **P2.01 System migrations**
  - `fx ship` writes one migration for each system package that changed (the core's stays in `packages/db/migrations`), committed in the system package. A system's `start` and its tests apply its migrations after the core's.
  - `db:check-migrations` and the schema check cover systems too.
  - **Needs:** nothing.
  - **Done when:** adding a field to a CRM object and running `fx ship` commits a CRM migration, and CI builds the CRM database from migrations alone.

- [x] **P2.02 Action ids agents can see**
  - MCP tool results show the `actionId` to the model (in the structured content or the text), as well as in `_meta`, so an agent can quote or look up what it did.
  - **Needs:** nothing.
  - **Done when:** Claude Code, asked to create an organisation over MCP, reports the action id, and the contract tests still pass.

### Config (`@workspace/config`; SYSTEM_DESIGN §4.4)

- [x] **P2.03 Config types and the file format**
  - Settle YAML or JSON in a decision record (phase 1 left it open).
  - `defineConfigType({ type, schema, references })` registers a type; modules and the core register theirs. Files live at `config/<type>/<key>.<ext>`; the key in the file must match its name.
  - **Needs:** nothing.
  - **Done when:** the decision is written, roles are a config type, and a test loads the CRM's roles from files.

- [x] **P2.04 `validateConfig`**
  - Validates every file against its type's schema, then cross-checks references against the running code: objects, fields, choice options, actions, events, templates and roles. Errors name the file, the path in it and what's wrong, in plain English.
  - Runs in `fx ship` and CI, and through a `config.validate` query for the web app and agents.
  - **Needs:** P2.03.
  - **Done when:** a role naming an action that doesn't exist fails CI with a message naming the file and line.

- [x] **P2.05 The loader and `config_versions`**
  - On start-up, and on each new commit to the branch the instance runs, the loader reads `config/`, validates it, and swaps an in-memory index in one go. It records each commit in a new `config_versions` table (sha, status, errors, loaded_at). Invalid config is refused; the last good version stays live.
  - `ConfigService` is backed by the loader, `config_sha` is set on every `action_log` row, and `defineSystem` no longer takes roles. Locally the dev server watches `config/` and reloads on save.
  - **Needs:** P2.04.
  - **Done when:** editing a role file under `fx dev` changes what a user can do without a restart, `action_log` rows carry the sha, and a broken file leaves the last good config live with the error logged.

### Choice fields (SYSTEM_DESIGN §4.5)

- [x] **P2.06 `f.choice`**
  - A field type that stores an option key and checks it against the loaded options. Options have a key, label, optional category and archived flag. `control` is `system`, `mapped` or `custom`, and decides what staff may change. Filters by key and, for `mapped`, by category.
  - Archived options stay valid on existing records but can't be newly chosen. Archiving an option that config still references is a validation error.
  - **Needs:** P2.01, P2.05.
  - **Done when:** the CRM has `organisation.industry` (custom) with tests for each control's rules.

- [x] **P2.07 Deals in the CRM**
  - A `deal` object (name, organisation, value as money, owner, `stage` as a mapped choice of `config/choices/deal-stages`) and a hand-written `deal.moveStage` action that owns `stage` and emits `deal.stageChanged` with the stage's category.
  - Choice options and labels appear in `system.describe`; the web app shows choice fields as selects, filters by them, and has an actor picker for refs to actors (`actor.list`, from P1b.04).
  - **Needs:** P2.06.
  - **Done when:** a deal can be created and moved through its stages from the web, and history shows each move with the stage labels.

- [x] **P2.07a Choice lists define their columns**
  - `defineChoiceList({ key, columns, keys })` in code: each list's own columns as Zod schemas, and any keys code acts on. Options have the built-in key, label, description and archived; `color` and `default` are reserved. `f.choice` takes the list, `control` goes, and `category` is the deal stages' own column.
  - **Needs:** P2.07.
  - **Done when:** the CRM's lists are defined in code, validateConfig checks each row's columns with file and line, and deals filter by `where: { category }`.

### Drafts and approvals (SYSTEM_DESIGN §4.4)

- [ ] **P2.08 Drafts over git**
  - Actions `config.draft.open`, `config.draft.save`, `config.draft.submit` and `config.draft.publish`. Open branches from `production`; each save commits one file and validates the whole set; publish merges into `production` in one commit and the bot copies it to `main`. Drafts are tracked in a new table.
  - **Needs:** P2.05.
  - **Done when:** against a bare test remote, a draft that edits two files publishes in one commit, the loader picks it up, and `main` has the same commit's changes.

- [ ] **P2.09 Approval rules**
  - An `approval` config type: which action, an optional condition (field, operator, value; no expressions), and who approves. The pipeline's approve stage finds matching rules, writes a `pending_approval` row and returns `approval_required`. `approval.approve` and `approval.reject` run or close the pending action, once.
  - Drafts whose files an approval rule covers wait for approval before they publish.
  - **Needs:** P2.05.
  - **Done when:** a rule on `organisation.archive` makes a sales user's archive wait until an admin approves, and approving runs it exactly once with both people in `action_log`.

- [ ] **P2.10 Drafts and approvals in the web app**
  - Config editors for choices and roles, built from the config types' schemas; a draft view with a plain-English diff; an approvals inbox for pending actions and drafts.
  - **Needs:** P2.07, P2.08, P2.09.
  - **Done when:** in the browser, a manager adds a deal stage in a draft, an admin approves it, and the new stage appears in the deal form after publish.

### Workflows (`@workspace/workflows`; SYSTEM_DESIGN §4.6, §4.7)

- [ ] **P2.11 Workflow definitions**
  - A `workflow` config type: trigger (event, schedule or manual), steps (`action`, `condition`, `wait`, `waitForApproval`), inputs as `from` or `value`, conditions as field, operator, value, and `onFailure`. Validation checks every action, event and input path.
  - Each workflow's permissions are derived from its steps, and the workflow is an automation actor.
  - **Needs:** P2.04.
  - **Done when:** an example workflow validates, a step naming an unknown action or a missing trigger field fails with a clear message, and the derived permissions are listed by `fx describe`.

- [ ] **P2.12 The dispatcher and the interpreter**
  - New `workflow_runs` and `workflow_step_runs` tables. The dispatcher reads new `event_log` rows and starts one DBOS run per event and matching workflow, exactly once. One DBOS workflow interprets every definition: it loads the pinned definition, resolves inputs and runs each step through the pipeline as the workflow's actor, with the event's origin user. Runs carry a depth count, and dispatch stops past a limit.
  - **Needs:** P2.07, P2.11.
  - **Done when:** moving a deal to won runs a workflow that creates a follow-up record, the run survives a server restart during a `wait`, and the step's `action_log` row has the workflow as actor and the person as origin user.

- [ ] **P2.13 Publish guard and authority review**
  - Publishing or approving a workflow needs every permission it derives. Any edit recalculates and checks again. A query lists workflows whose publisher or approver no longer holds a permission they use.
  - **Needs:** P2.08, P2.12.
  - **Done when:** a sales user can't publish a workflow that archives organisations, and removing a permission from the publisher's role puts the workflow on the review list.

- [ ] **P2.14 Dry runs and the run inspector**
  - A draft workflow runs against a sample event with every action in dry-run mode, showing each step, its result and any missing permission. The record timeline shows the runs a record's events caused, step by step, and each object has a "What happens when…" view.
  - **Needs:** P2.10, P2.12.
  - **Done when:** in the browser, a dry run of a draft workflow shows each step's result without writing anything, and a deal's timeline shows the run its move caused.

### Comms and calls out (SYSTEM_DESIGN §4.6, §4.10)

- [ ] **P2.15 `defineModule` and comms**
  - `defineModule({ name, objects, actions, configTypes, events })`, switched on in `defineSystem`. The comms module has an `email_send` object, an `email-template` config type, and `comms.send`, which renders a template and sends through the dev sink, emitting `email.sent` or `email.failed`.
  - **Needs:** P2.11.
  - **Done when:** a workflow step sends a templated email that appears in the console and in the record's history.

- [ ] **P2.16 `http.send`**
  - An action that posts a signed payload in a standard envelope to a URL fixed in the workflow file, with retries and backoff, recording the response. Validation refuses a URL taken from `from`. `onFailure` defaults to `continue`.
  - **Needs:** P2.12.
  - **Done when:** a workflow step calls a local test endpoint, the signature verifies, and a failing endpoint doesn't stop the rest of the run.

### The Effect trial (decision 0008)

- [ ] **P2.17 Effect 4 trial** _(time-boxed: two days)_
  - On a branch that is never merged, rebuild the action pipeline, one HTTP route, one MCP tool and one workflow in Effect 4. Compare it with the plain TypeScript version on: agent first-time success at small changes (the same three tasks given to an agent on each), lines of code, readability for a newcomer, and unstable Effect APIs touched.
  - Write a decision record with the numbers and a recommendation: adopt inside the core, defer again with a new trigger, or drop. Decision 0008's revisit triggers still apply.
  - **Needs:** P2.12.
  - **Done when:** the decision record is merged and links the trial branch.

### Exit

- [ ] **P2.18 Phase exit demo**
  - In `examples/crm`, a sales manager adds the deal stage "Negotiation" (category: open) and a workflow that emails the sales director when a deal enters it, in one draft from the web app. An admin approves; it publishes; the loader picks it up with no restart or deploy.
  - Then a deal moved to Negotiation from the web, and another moved by Claude Code over MCP, each send the email. History and the run inspector show the workflow as actor and the right origin user.
  - Record any surprises in the log, update AGENTS.md and the README status, set phase 2 to Done in `docs/plans/README.md`, and write `phase-3.md`.
  - **Needs:** all of the above except P2.17.
  - **Done when:** the demo works end to end from a clean clone.

## Log

- 2026-11-07 · plan · Written at the end of phase 1 (P1.23).
- 2026-11-08 · P2.01 · Each system keeps its own drizzle journal in `<package>/migrations`, applied after the core's and recorded in `drizzle.__drizzle_migrations_system` (decision 0036). `fx ship` generates in `packages/db` and every system package with a drizzle config, in one migration commit. The CRM's drizzle config now lists only its objects, with a `tablesFilter`, so Studio gets its own config to show the core tables too. drizzle-kit writes foreign keys to `actors` without the core schema loaded. The CRM's tests and `db:check-migrations` build its database from migrations alone. Surprise: `pnpm format` rewrote the generated snapshot JSON, so oxfmt now ignores every package's `migrations/`, as it did the core's.
- 2026-11-08 · P2.02 · Surprise: a text block alone wasn't enough. Claude Code shows the model `structuredContent` when a result has one, and ignores the other text blocks, so its first try said the id was missing. An action's `structuredContent` now has `actionId`, and each action tool's output schema has it too. The `actionId: <id>` text block stays for clients that read text, and on errors, which have no structured content. Checked with `claude -p` against the CRM: it reports the action id.
- 2026-11-08 · P2.03 · YAML 1.2 with the `yaml` package, plain only: no anchors, aliases or tags (decision 0037). `readConfig` maps each Zod issue to a line through the parsed document. Zod reports a permission that matches neither union member as a bare "Invalid input", so `readConfig` reports the closest member's issues instead (fewest issues wins), which also gives the right line. The CRM's `src/roles.ts` now reads `config/roles/*.yaml`; defineSystem still takes roles until P2.05.
- 2026-11-08 · P2.04 · `validateConfig` checks references against a `ConfigCatalog` that `@workspace/server` builds from the system: objects and fields, the actions and queries a role can grant by name (hand-written ones), generated ones and events. A role naming a generated action such as `organisation.create` gets told to grant it as an object permission, since the authorise stage checks those through the object. `defineSystem` takes `config` (the folder), which adds `config.validate` and `system.validateConfig()`. `pnpm config:validate` runs in `fx ship` and as its own CI step. Templates and roles resolve against other config files; choices wait for P2.06.
- 2026-11-08 · P2.05 · The loader reads the working tree and hashes it for a sha; the git source comes with P2.08 (decision 0038). The pipeline pins one config snapshot per run. Checked by hand with the CRM in dev mode: dropping `view` from `admin.yaml` took effect on save, a broken file was refused with file and line while the last good version stayed live, and `action_log` rows carry the sha. Surprises: the boundary test (rule 7) scans every package but turbo only reruns it when `@workspace/actions` changes, so P2.04's `config.validate` merged importing `@workspace/config` in a handler. It now goes through `ctx.config.validate()`. And I named `loaded_at` with the `createdAt()` helper, which made the column `created_at`; only reading the table with SQL caught it.
- 2026-11-08 · P2.06 · Choice values are checked in the repository against the options pinned for the run, not by the field's Zod input, since options change with config (decision 0039). A `system` field's input is still an enum of its keys. `validateConfig` holds each list to its fields' control, and a `list.option` reference must name a live option, which is how archiving an option config still uses is refused. Config types that use options (approval rules, workflows) come later, so nothing refers to an option yet. The contract tests pick a live option for choice samples.
- 2026-11-08 · P2.07 · The CRM has `deal` (name, organisation, value, owner, stage). A hand-written `deal.create` owns the create job so a new deal starts in an open stage: otherwise a deal could be created already won, with no `deal.stageChanged` for P2.11's workflow, or lost with no reason. `deal.moveStage` owns `stage` after that and emits `deal.stageChanged` with the stage's category; a lost stage needs a reason. Choice columns get an index from `defineObject`, as refs do. The pipeline pins `ctx.config.choice(list).get(key)` from the same choice snapshot as the repository, and it returns only an option that can be chosen now. `system.describe` lists each option's key, label, category and archived flag (empty when the list isn't loaded). The web shows choice fields as selects, filters by key or category, and names history values by label. A ref to `actor` is a picker of `actor.list`, labelled with the person's name and email.
- 2026-11-08 · P2.07a · Added after P2.07: options had a fixed `category` and fields a `control`, which didn't fit lists whose rows carry other values, such as a plan's flags. Lists now define their own columns in code (decision 0040), staff edit rows, and `category` is just the deal stages' column. The YAML's shape didn't change. Options gained `description`, shown as a hint under the select and given to agents through `system.describe`. `@workspace/config` now depends on `@workspace/objects` for the built-in option columns.
