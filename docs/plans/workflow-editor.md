# The workflow editor

**Status:** in progress. Decisions 0053 to 0058 are accepted (10 Nov 2026). WE.02 is done; the editor itself is not built yet.

**Goal:** a person can open any workflow and understand it end to end: what starts it, what each step does, where each value comes from, where a run may pause, what happens when a step fails, who can call it and who it acts as. Then they can change it. Most workflows are written by agents over the API or MCP, so the editor is first a place to read and check, and second a place to build. Everything an agent can set in a workflow file can be edited here, through the same operations, with the same roles, validation, drafts and approvals. The web app gets nothing the API lacks.

**Out of scope:**

- Run data drawn over steps. Runs stay in Activity → Workflow runs; the editor links there.
- New kinds of step, loops and an expression language (SYSTEM_DESIGN §8). Building a value from parts is the five actions in WE.17a, not a template in a fixed value.
- The in-app agent's harness (phase 4). Phase 4 of this plan builds only what the web app gives it.
- Building `http_send` (P2.28) or example cases (P2.22). Tasks that need them say so.
- Editing code workflows. They are TypeScript, shipped with a release; the editor shows them and says why they can't be changed here.

## Resume here

- **Status:** in progress. Decisions 0053 to 0058 were accepted on 10 Nov 2026. See **Answers**. WE.02 is done. WE.01 and WE.03 can still land in either order.
- **Next task:** WE.01. WE.03 can go with it, in any order; WE.04 needs WE.01. After phase 1, WE.10a looks again at step labels before any schema change. WE.17a (the value-building actions) comes straight after WE.17.
- **Decision numbers.** The brief asked for records from 0049, but 0049 to 0052 were taken by the time this was written, so the editor's records are 0053 to 0058.
- **Names.** The draft operations are still `draft.save`, `draft.files` and so on, on `/actions` and `/queries`, until P2.24 makes them the `draft_*` workflows. This plan uses the snake_case names. A task that changes one changes whichever exists when it starts.
- **How to start:** see [README.md](README.md) and AGENTS.md. The CRM (`examples/crm`) is the system to check against. Editing needs a config remote: run it with `CONFIG_REMOTE=local`.

## How this fits phase 2

- **P2.23 is split in two.** It bundled the run inspector with the workflow view. This plan's phase 1 is the workflow view and the "What happens when…" view, so WE.00 split P2.23 into **P2.23a** (Activity → Runs: a run's steps drawn with segments, branches, errors and retries, and record history linking to runs) and **P2.23b** (the read-only workflow view and "What happens when…"), and P2.23b is done by WE.04 to WE.10. P2.10f and P2.30 need P2.23a only.
- **P2.23a draws a run with the outline from WE.06,** so a run and its definition look alike. WE.06 is a dependency of P2.23a.
- **New operations are code workflows from the start,** read-only where they only read, as P2.24 makes the rest of the core. None exists in the core yet (`defineWorkflow` is used only in tests), so WE.01 is the first and sets the pattern. A step's action runs under the service key and knows the origin user but not the calling actor (`packages/actions/src/step.ts`), so these operations never say "mine": they take a `draft_id`.
- **What waits for phase 2:** WE.28 to WE.30 need P2.22 (example cases). The approval step's form (WE.19) can be built before P2.21, since the schema already has `wait_for_approval`, but can only be tried end to end after it. `http_send`'s form needs nothing special: it is an action with a fixed input, which WE.16 and WE.17 handle for any action.

## Decisions for this work

Each has a record; this is the summary.

### The layout: an outline of steps ([0053](../decisions/0053-workflow-editor-outline.md))

The steps are a tree: they run in order, an `if` nests `then` and `else`, and `on_failure` nests steps. There are no joins, no jumps and no parallel branches (`packages/workflows/src/schema.ts`). So the editor is a **vertical outline**: one row per step, in file order, with branches and failure steps indented under the step that owns them.

|  | Outline (chosen) | Free canvas | Graph laid out from the tree |
| --- | --- | --- | --- |
| UI-only state in the file | None: the file's order is the layout | Positions, which the strict schema refuses | None |
| A small change looks small | One row changes | Yes, if nobody moves nodes | No: one new step can move every node |
| Stable after an agent rewrites it | Yes | No: new steps have no position | Mostly |
| Narrow panes and phones | Works at the main pane's 28rem floor (`apps/web/src/shell/sidebar.ts`) | Needs pan and zoom | Needs pan and zoom |
| Keyboard and screen reader | Nested lists and buttons | A second structure has to be built for it | The same |
| `on_failure`, pauses, cuts | A nested group; a divider row between steps | Extra node and edge kinds | Extra node and edge kinds |
| New dependency | None | A canvas library | A layout library, and usually a canvas one |

- **The page** reads top to bottom as the run goes: what starts it, what it takes, the steps, what it gives back, what happens on failure, what it emits and which workflows that starts.
- **A step row** is a sentence: "Update the deal: stage from the input's stage". Selecting it opens its detail, beside the outline when the pane is wide and under the row when it is narrow.
- **A segment cut** is a divider row at the step that cuts: "Commits here, then waits 3 days". A cut inside a branch says "only if this branch runs".
- **View state never goes in the file.** The selected step, the tab and the version are in the URL, so a link shows exactly what the sender saw. Collapsed branches are in `localStorage`, per workflow, as the sidebar's width is.
- **What would change this:** steps gaining parallel branches or joins, which is a new decision anyway. Then add a graph drawn from the definition as a second, read-only view. A free canvas stays out as long as the file holds no positions.

### One way to change a workflow: save the whole file, with its revision ([0055](../decisions/0055-saving-config-files-with-a-revision.md))

- **The editor edits the person's working draft in place,** as choice lists do (decision 0044). Edits are held in the page, checked as they are made, and saved with an explicit **Save to draft**. There is no autosave: every save is a git commit, re-checks all config and withdraws a request for approval (`packages/config/src/drafts.ts`).
- **A save sends the whole file and the revision it was read at.** A file's `revision` is an opaque string that changes when its content does. `draft_save` refuses a stale one as a `conflict`. This is the same idea as an object's `version` and `If-Match`, carried in the input so HTTP and MCP behave alike.
- **No step-level operations.** "Insert a step" and "move a step" as API calls would be a second way to change a file, with their own rules for addressing and ordering. Agents and the editor both send the file.
- **Who may save into a draft:** its creator, the creator's agents, and the person an agent's draft belongs to. So the in-app agent can save into the draft the person has open, and the person sees one draft. Any other agent that isn't told a draft id saves into its own, and the editor says "another draft changes this workflow", with Compare and Copy into my draft.
- **Staying current:** the page asks for `draft_mine` every 15 seconds while it is visible, and on focus. That is a database read, and it carries the draft's `head_sha`. When it changes, the page reads the file again. With no unsaved edits it updates; with some, it says the file changed and offers to compare. No sockets and no presence.
- **Live moved:** `workflow_get` says when the live file has changed since the draft began. `draft_rebase` moves the draft onto the current live config; for a file both changed, the person picks theirs or live. Nothing merges inside a file.
- **What would change this:** two people often editing one workflow at the same moment. The answer then is showing who else is on the page, not merging.

### Reading workflows over the API ([0054](../decisions/0054-reading-workflows-over-the-api.md))

Today a caller can read a workflow's input and errors only if they may call it, and nobody can read its steps except through `fx describe` (`packages/actions/src/describe.ts`). The editor needs the definition, the check and the parts a step can use, and so does an agent. They are read-only code workflows, granted by name in a role like any workflow, and so are MCP tools and OpenAPI operations with no further work.

### Step forms come from schemas ([0056](../decisions/0056-step-forms-from-schemas.md))

An action step's form is built from the action's input JSON Schema, one row per input. Each row is a fixed value or a value from data. An input the renderer has no control for gets a JSON box, so every action is usable with no UI code. Labels and help come from the schema's own `title` and `description`, set in code; nothing about the form is in the workflow file. The data picker offers only what `validateWorkflow` would accept at that step, because the same check supplies the list.

### Test runs ([0057](../decisions/0057-test-runs-of-draft-workflows.md))

`workflow_test` runs a draft or live workflow once with a sample input or event, on P2.22's runner: one transaction that is always rolled back, waits skipped, approvals and external steps faked. Its trace is kept as a dry run. A test is an example case that hasn't been saved yet, so its result comes back in a case's shape and saving it is an ordinary `draft_save`.

### What the agent sidebar gets ([0058](../decisions/0058-page-context-and-links-for-the-agent.md))

Two things that work on every screen, not only this one: the **page context** (what the person is looking at, as plain data) and **links** (how the agent points at something: every step, field and version has a URL). The agent's edits go through `draft_save` like anyone's, and the editor shows them as a change to review.

## The API the editor needs

Found by reading the code, not assumed. "Exists" means it is in `main` today.

**What exists and is enough**

| Need | Where |
| --- | --- |
| Save, undo, discard, publish, review a draft | `draft.save`, `draft.revert`, `draft.discard`, `draft.publish`, `draft.get`, `draft.mine` in `packages/config/src/drafts.ts` |
| Who can call a workflow | `role.list` in `packages/actions/src/identity-queries.ts` gives every role with its `workflows` |
| Runs of one workflow | `run.list` takes `endpoint`, and a workflow run's endpoint is its key (`packages/actions/src/logs.ts`, `packages/workflows/src/run.ts`) |
| A run's steps and the config it ran under | `run.get` returns `steps[].stepId` and `configSha` (`packages/actions/src/log-schemas.ts`) |
| Sample events for a test | `eventLog.list` filters by `type` |

**What is new or changes.** Every new one is a code workflow, so it is `POST /workflows/<name>` (or `GET` with `?input=` when read-only), an MCP tool of the same name, an OpenAPI operation and an entry in `system_describe` for callers whose roles name it. Input keys are snake_case (decision 0047).

| # | Operation | Input | Output | Who may | Task |
| --- | --- | --- | --- | --- | --- |
| 1 | **`workflow_list`** (new, read-only) | `draft_id?` | Every workflow, in code and in config: `key`, `label`, `description`, `source` (`code` or `config`), `path`, `starts_when`, `read_only`, the events it `emits`, the workflows it `runs`, counts of problems and warnings, and with a draft, whether the draft adds, changes or removes it | Roles naming it | WE.01 |
| 2 | **`workflow_get`** (new, read-only) | `key`, and `draft_id?` or `sha?` (neither: live) | `definition` (the value), `content` (its YAML; made from the definition for a code workflow), `revision`, `source`, `editable` and, when false, why (`code`, `no_config_remote`, `past_version`), `at` (live, draft or version, with the sha, and for a draft who saved it last and when), `live_revision`, `behind` (live changed this file since the draft began), and `check` | Roles naming it | WE.01 |
| 3 | **`check.scopes`** (new output of `validateWorkflow`) |  | For each step, by its path: the steps whose output it may read. Once per workflow: each step's output as JSON Schema, and the input's or event's fields as `system_describe` describes fields (type, target, choice list, options, option columns) | Part of 2 and 4 | WE.02 |
| 4 | **`workflow_validate`** (new, read-only; SYSTEM_DESIGN §4.6 already names it) | `key`, `value` or `content`, `draft_id?` | `value`, `content` (as a save would write it), and `check`: `problems` and `warnings` (path, line, message), `segments`, `scopes`. Checked against the draft's other files, or live | Roles naming it | WE.11 |
| 5 | **`action_list`** (new, read-only) | none | The actions a step can run (`System.stepActions`): `name`, `description`, `kind`, `read_only`, `fixed_inputs`, `input` and `output` as JSON Schema, `errors`, `emits`, and for a record action its `object` | Roles naming it | WE.03 |
| 6 | **`event_list`** (new, read-only) | `draft_id?` | Every event: `type`, its payload (fields, or JSON Schema), where it comes from (an object, an action or the workflow that declares it), and the workflows it starts | Roles naming it | WE.03 |
| 7 | **`draft_save`** (changes) | adds `revision?` | Refuses a stale revision as `conflict`. Returns the saved file's new `revision`. With `value`, keeps the file's comments, key order and style where the value hasn't changed. Refuses a draft that isn't the caller's, their agent's or their person's | As today | WE.12, WE.13 |
| 8 | **`draft_files`** (changes) | adds `path?` | Each file gains `revision`; `path` returns one file | As today | WE.12 |
| 9 | **`draft_mine`** (changes) |  | The draft gains `head_sha`, from a new nullable `drafts.head_sha` column set on each save and revert | As today | WE.12 |
| 10 | **`draft_list`** (changes) | adds `path?`, `open?` | Drafts that change one file. Without the grant, a caller still sees their own and their agents' | As today | WE.22 |
| 11 | **`draft_rebase`** (new) | `id`, `keep?` (per path, `mine` or `live`) | The draft on the current live config, checked; or `conflict` naming the files both changed | Roles naming it, on a draft they may save | WE.23 |
| 12 | **`config_history`** (new, read-only) | `path`, `limit?`, `cursor?` | The published commits that changed a config file, newest first: `sha`, `at`, `title`, who, and the draft it came from. Needs a new `GitService.log` (`packages/actions/src/define-action.ts`, `packages/config/src/git.ts`) | Roles naming it | WE.26 |
| 13 | **`workflow_test`** (new) | `key`, `draft_id?`, `input` or `event`, `caller?`, `fakes?`, `approvals?` | The output or error, each step with its input, output, error, branch and segment, the changes and events it would have written, the id of the dry run that keeps the trace, and the same thing as an example case | Roles naming it. The grant is a serious one: a test runs under the service key against real records (decision 0057) | WE.28 |
| 14 | **`run_list`** (changes) | adds `step?`, `step_failed?` | Runs that reached, or failed at, one step | As today | WE.31 |

**What doesn't change:** `system_describe` keeps meaning "what you may call". The new operations show up in it because they are workflows. The web app keeps reading it for navigation and for the Run form.

**Types.** `apps/web` may `import type` from a fixed list of packages (`webTypeOnlyPackages` in `packages/actions/src/architecture.ts`). `@workspace/workflows` joins it in WE.04, for `WorkflowDefinition`, `Step` and `WorkflowCheck`. Rule 9 already lets the web app depend on it.

## Tasks

Each task is one change. **[API]** changes `packages/` and reaches HTTP and MCP; **[web]** changes only `apps/web` (and `packages/ui` for a shared component); **[docs]** changes only documents. Web logic goes in pure functions under `apps/web/src/lib/` with Vitest tests, as the app's other logic does; "in the browser" means the CRM under `pnpm fx dev`.

### Phase 0: agree

- [x] **WE.00 Accept the decisions and split P2.23** [docs]
  - Dylan answers the open questions. Decisions 0053 to 0058 become `Accepted` (changed where an answer differs), with their rows in `docs/decisions/README.md`.
  - `docs/plans/phase-2.md`: P2.23 becomes P2.23a (run inspector) and P2.23b (the workflow view, done by this plan); P2.10f and P2.30 need P2.23a. SYSTEM_DESIGN §4.6 **Visibility** and §4.9 describe the editor, and the glossary gains **revision**.
  - **Needs:** nothing.
  - **Done when:** the records are accepted, phase 2's plan shows the split, and this plan's **Resume here** names WE.01.

### Phase 1: view and understand

- [x] **WE.01 `workflow_list` and `workflow_get`** [API]
  - Two read-only code workflows in the core, each one step running a read-only internal action, as rows 1 and 2 above. Live reads come from the config the call pinned (`ctx.config.workflows`, which already holds every definition); a draft or a sha is read with `ctx.git`, and without a config remote those inputs are refused with the message drafts already give. `revision` is the file's git blob id. A code workflow has `source: code`, `editable: false` and no revision.
  - `check` here has problems, warnings and segments; scopes come with WE.02. The CRM's admin and manager roles are granted both.
  - **Needs:** nothing (P2.18 is done).
  - **Done when:** over HTTP and MCP, `workflow_get` returns `deal_move_stage` with its steps, its one warning (no ownership check) and its one segment; `deal_won_task`, which nothing can call, is in `workflow_list`; a sales user gets a permission error; and the contract tests cover both.

- [x] **WE.02 Scopes from `validateWorkflow`** [API]
  - `WorkflowCheck` gains `scopes` (row 3). The checker already knows which steps have run on every path to a step (`flow.ran` in `packages/workflows/src/validate.ts`); this records it per step path, with each step's output schema once. Input and event fields are described as `describeField` does in `packages/actions/src/describe.ts`, so a choice field carries its list, options and columns.
  - **Needs:** nothing.
  - **Done when:** tests show that in `deal_move_stage`, `update` may read `load`; that in a test workflow a step inside a `then` branch is not readable after the `if`, and a step in `on_failure` reads only what its owner could; and `workflow_get` returns scopes once WE.01 is in.

- [x] **WE.03 `action_list` and `event_list`** [API]
  - Rows 5 and 6. `action_list` is `System.stepActions` through `describeAction`, plus `object` for the generated record actions. `event_list` joins the catalog's events and payloads (`packages/server/src/catalog.ts`) with the events workflows declare and the workflows each one starts.
  - **Needs:** nothing.
  - **Done when:** over HTTP and MCP, `action_list` includes `deal_update` (internal, with its input schema and `object: deal`) and `record_belongs_to_caller` (read-only); `event_list` shows `deal_stage_changed` declared by `deal_move_stage` and starting `deal_won_task`.

- [ ] **WE.04 The workflows list and the workflow page** [web]
  - `/automation/workflows` lists every workflow from `workflow_list` for people who may read it: label, what starts it, whether it is code or config, and whether their draft changes it. People who may only call workflows keep today's list of Run forms. `lib/nav.ts` shows Automation → Workflows for either.
  - `/automation/workflows/$key`: the page header (label, key, **Code** or **Config**, **Read only**), a **Your draft / Live** toggle when the draft changes it, tabs (Workflow, File, and later Changes, History and Test) from `packages/ui`, and Run for a callable one. `?v=`, `?step=` and `?tab=` hold the version, the selected step and the tab. A code workflow says "Written in code and shipped with a release, so it can't be changed here". `@workspace/workflows` joins `webTypeOnlyPackages`.
  - **Needs:** WE.01.
  - **Done when:** in the browser, an admin opens Move stage from the list and sees its description and key; a workflow started by an event is listed; a sales user still sees only their Run forms.

- [ ] **WE.05 Words for triggers, values and conditions** [web]
  - `lib/workflow-words.ts`, pure and tested: what starts a workflow ("When a deal's stage changes, if the new stage's category is won"; "Every weekday at 09:00 UTC", with the viewer's local time beside it, falling back to the five named fields for a schedule it can't phrase); a condition for each of the nine operators, with choice columns ("the stage's category is lost"); a value ("the deal from the input", "the record's stage from the step Load", a fixed value); a duration. The file stays in UTC: no time zone is added to it.
  - The page shows what starts it, its input fields, its output and its errors, using them.
  - **Needs:** WE.04.
  - **Done when:** tests cover each operator, each kind of start and each kind of value; in the browser the three CRM workflows read as sentences.

- [ ] **WE.06 The outline** [web]
  - `lib/workflow-tree.ts` (walk the steps with their paths; find a step by id or path) and the outline: one row per step for all eight kinds, each a sentence from WE.05 with the step's kind as an icon and a word; `then`, `else` and `on_failure` as labelled nested groups; `fail` and `output` marked as ending the run; the workflow's own `on_failure` and `attention_role` after the steps.
  - Nested lists and buttons, so it reads in order with a screen reader. Up and down move between rows, left and right close and open a branch, Enter selects. Collapsed branches are kept in `localStorage` per workflow. A step with no id (`fail`, `output`) is addressed by its path.
  - The detail of the selected step, read-only: every input and where it comes from. Beside the outline when the pane is wide (a container query, since the agent sidebar narrows the pane), under the row when it isn't.
  - **Needs:** WE.05.
  - **Done when:** tests cover the tree walk; in the browser `deal_move_stage` shows its `if` with the `fail` inside, the keyboard reaches every row, and at a 28rem pane nothing scrolls sideways.

- [ ] **WE.07 Pauses, segments and who it acts as** [web]
  - Segments from `check.segments`: a divider at each step that ends one, saying why in the check's own words and "only if this branch runs" when conditional; external steps sent after a commit marked so; a count in the header ("May pause in 2 places"). Never colour alone.
  - A panel on who can call it (roles from `role.list` that name it, or "Nothing can call it: an event starts it") and who it acts as: "Its steps run with full access. Each run records this workflow as the actor and the person who started it as the origin user." The no-ownership-check warning is shown here.
  - Adds a CRM workflow with a `wait` and `on_failure`, so there is one to look at.
  - **Needs:** WE.06.
  - **Done when:** in the browser the new workflow shows its cut at the wait and its failure steps, and Move stage shows the roles that may call it and its warning.

- [ ] **WE.08 Where values come from, and problems** [web]
  - Each `from` that reads a step links to that step; focusing either highlights both. Each step lists what reads its output. Problems and warnings from `check` sit on the step and field their path points at, with a count on collapsed branches and a summary at the top that jumps to each.
  - **Needs:** WE.06.
  - **Done when:** in the browser, choosing "the record's stage from Load" on `announce` selects `load`; a draft workflow with an unknown action shows the problem on that step and in the summary.

- [ ] **WE.09 Events: what happens next, and what happens when** [web]
  - On the workflow page: the events it emits, and under each the workflows it starts, linked. Automation → Events lists every event from `event_list` with the workflows it starts. An object's page (`routes/_app/data.objects.$object.tsx`) gains "What happens when…": the workflows its four generated events start. Automation → Actions lists `action_list`, which is what steps can really run.
  - **Needs:** WE.03, WE.04.
  - **Done when:** in the browser, Move stage shows `deal_stage_changed` starting `deal_won_task`, and the Deal object shows `deal_owner_task` under "when a deal is updated".

- [ ] **WE.10 The file, and links to and from runs** [web]
  - The File tab shows `content` as it is in git, read-only, with problems listed by line. The page links to Activity → Workflow runs for this workflow (`routes/_app/activity.runs.index.tsx` gains an exact `workflow` filter beside its prefix one). A run's page (`activity.runs.$id.tsx`) links each step to the workflow at the run's `configSha` with that step selected; a version that can no longer be read falls back to live and says so.
  - **Needs:** WE.06.
  - **Done when:** in the browser, a run of Move stage opens the workflow with `update` selected, and the workflow's Runs link lists only its runs.

- [ ] **WE.10a Look again at step labels** [docs]
  - Decision 0053: a row is read from the step's id and what it does, and a step has no `label`. With the read-only outline on screen and the CRM's real workflows in it, decide whether that reads well. If it does not, the next task adds an optional `label` on each step, which amends decision 0048. This task does not change the file.
  - **Needs:** WE.10.
  - **Done when:** the log records the look: either rows stay as they are, or a follow-up task is added for the optional `label`.

### Phase 2: edit

- [ ] **WE.11 `workflow_validate`** [API]
  - Row 4. Takes a value or YAML, never saves, and checks it with `validateConfig` laid over the draft's files (or live), so its problems are the ones a save would give. Returns the value and the YAML each way, which is how the editor moves between its form and the file without parsing YAML in the browser.
  - **Needs:** WE.02.
  - **Done when:** over HTTP and MCP, a value whose step reads a later step returns that problem with its path and no commit is made; YAML with a syntax error returns the line.

- [x] **WE.12 Revisions on draft files** [API]
  - Rows 7 to 9: `draft_save` takes `revision` and returns the new one; `draft_files` returns each file's and can read one `path`; `drafts.head_sha` (a nullable column, an expand-only migration) is set on save and revert and returned by `draft_mine`. A save into a draft that isn't the caller's, their agent's or their person's is refused. Choice lists and roles send revisions too (`components/config-files.tsx`, `routes/_app/settings.choices.$list.tsx`).
  - **Needs:** nothing.
  - **Done when:** tests show a save with a stale revision is a `conflict` that changes nothing, a save without one still works, an agent can save into its person's draft by id, and a stranger can't.

- [x] **WE.13 Saves by value keep the file's comments** [API]
  - Today a save with `value` writes fresh YAML (`stringify` in `drafts.ts`), which drops comments and rewrites every line. The CRM's workflow files all open with comments. Instead, apply the value to the file's parsed document with the `yaml` package, which SYSTEM_DESIGN §9 chose for this: unchanged parts keep their text, list items are matched by `id` or `key` where they have one, and only a changed part is rewritten.
  - **Needs:** nothing.
  - **Done when:** a test changes one step's `with` in `deal_move_stage.yaml` by value and the commit's diff touches only that step and keeps the header comment; choice lists and roles keep theirs.

- [ ] **WE.14 Edit mode and saving** [web]
  - Edit turns the page into a working copy held in the page: undo and redo, each change checked with `workflow_validate` after a short pause, and **Save to draft** sending the value with its revision. A conflict offers Compare and Reload. Leaving with unsaved edits asks first. When the draft waits for approval, Save says it withdraws the request, as choice lists do. Publish stays in the header pill.
  - New workflow (a key, a description and what starts it) and Delete (a save with no content). Read-only cases each say why: code, no config remote, a past version, or roles that can't save drafts.
  - **Needs:** WE.08, WE.11, WE.12.
  - **Done when:** in the browser a manager changes Move stage's description, saves, and the pill shows the edit; saving from a second tab that is behind is refused with the choice to compare or reload.

- [ ] **WE.15 Add, remove, move and duplicate steps** [web]
  - `lib/workflow-tree.ts` gains insert, remove, duplicate (with a new unique id), move up and down, move into the branch before and out of a branch, and rename an id (rewriting every `steps.<id>.…` that reads it). Each is a button or menu item on the row and a keyboard command, announced to screen readers. No dragging: moving is a command, and it has to work from the keyboard. Removing a step that others read lists them first.
  - **Needs:** WE.14.
  - **Done when:** tests cover each operation and the rename; in the browser, using only the keyboard, a step is added, moved into the `then` branch and out again.

- [ ] **WE.16 The value input and the data picker** [web]
  - One control for every `{ from }` or `{ value }`: **Fixed value** or **From data**. From data opens a picker of what `scopes` allow at that step: the input's or event's fields, and each readable step's output, browsed by its schema, with choice columns under choice fields. Paths that don't fit the target's type are shown apart. A fixed input (`fixed_inputs`) offers only Fixed value and says why.
  - **Needs:** WE.14.
  - **Done when:** in the browser, on `announce`, the picker offers the input's fields and the outputs of `load` and `update`; a step added inside a `then` branch is not offered to steps after the `if`; picking a field writes its path; and a fixed input can't be switched to From data.

- [ ] **WE.17 Action step forms from the action's schema** [web]
  - `lib/schema-form.ts`: from an action's input JSON Schema, one row per input with its `title` or name, `description`, required mark and a fixed-value control by type (text, number, switch, select for `enum`, date for a date format, a JSON box for objects, arrays and anything else). A record action uses its object's fields for labels, choice options and record pickers. Picking a different action keeps inputs with the same name.
  - **Needs:** WE.03, WE.16.
  - **Done when:** tests cover each schema type and the fallback; in the browser a step is switched to `task_create` and filled in; and a test action with an input the renderer doesn't know still saves through the JSON box.

- [ ] **WE.17a Actions that build a value** [API]
  - Five internal actions, the same closed set as computed fields (decision 0052): `text_join` joins text, email and url parts, skipping empty ones, with a space unless a separator is set; `value_first` returns the first value that is present, and zero counts; `number_add`, `number_subtract` and `number_multiply` combine numbers and return null when any part is empty. A step runs one of them. They appear in `action_list` and use WE.17's schema form, with no form of their own. A fixed value stays a fixed value: no template syntax.
  - **Needs:** WE.17.
  - **Done when:** tests cover each action, including an empty part; in the browser a step joins a name into a task title from earlier steps and saves.

- [ ] **WE.18 The condition builder** [web]
  - For `if`, `starts_when.when` and `wait_for_approval.when`: rows of field, operator and value. The field is the picker from WE.16; the operators offered fit its type; the value is a select for a choice field or an enum column, a number box for the comparing operators, a list for `one_of`. Each row shows its sentence.
  - **Needs:** WE.16.
  - **Done when:** in the browser, "stage's category is lost and reason is empty" is rebuilt from nothing and saves as the same YAML the CRM has.

- [ ] **WE.19 Forms for the built-in steps** [web]
  - `wait` (a duration, or until a value), `wait_for_approval` (approver, approvals, requester and exempt roles from `role.list`, conditions, message), `run` (a workflow, then its input as an action's is), `emit` (an event, then its payload), `fail` (one of the workflow's errors, optional message), `output`, and `on_failure` on a step: none, **leave**, or steps.
  - **Needs:** WE.17, WE.18.
  - **Done when:** in the browser each kind is added, filled in and saved with no problems, and the file holds what the form showed.

- [ ] **WE.20 The workflow's own settings** [web]
  - Label and description; what starts it (called, an event with conditions, or a schedule with common choices and the five fields); `read_only`; input fields with their types and options; output; errors and their messages; declared events and their fields; `attention_role`; and the workflow's `on_failure`. Changing what starts it says what else must change (an event-started workflow takes no input).
  - **Needs:** WE.18.
  - **Done when:** in the browser a new workflow is built from nothing to match `deal_won_task`, and `workflow_get` returns the same definition.

- [ ] **WE.21 Editing the file directly** [web]
  - The File tab becomes editable for config workflows: a plain text area, checked with `workflow_validate` by `content`, saved as `content` so comments are kept exactly. Switching between Workflow and File with unsaved edits converts through `workflow_validate`. Problems are listed by line. No code-editor library.
  - **Needs:** WE.14.
  - **Done when:** in the browser a comment added in the File tab survives a save, and a YAML mistake shows its line and blocks Save.

- [ ] **WE.22 Other drafts, and staying current** [API] [web]
  - Row 10. The page asks `draft_mine` every 15 seconds while visible and on focus, and reads the file again when `head_sha` changes: it updates when there are no unsaved edits, and otherwise says who changed it and offers Compare. It lists other open drafts that change this workflow (from `draft_list`), with Compare and **Copy into my draft**, which is a save.
  - **Needs:** WE.14.
  - **Done when:** in the browser, an agent's save over MCP into the manager's draft appears on the open page within 15 seconds; an agent's own draft is listed as another draft with a working Compare.

- [ ] **WE.23 Catching up with live** [API] [web]
  - Row 11, `draft_rebase`, and its screen: when `behind` is true the page says "Live changed since your draft began", shows live beside the draft, and offers Keep mine or Take live for this file. Amends decision 0041, which today ends in "start a new draft".
  - **Needs:** WE.22.
  - **Done when:** against a test remote, a draft whose file production changed is rebased keeping mine and then publishes; the same in the browser.

### Phase 3: test and compare

- [ ] **WE.24 Workflow changes in plain English** [web]
  - `lib/workflow-diff.ts`: compares two definitions, matching steps by id (and by place for `fail` and `output`), into added, removed, moved and changed steps and changed settings. `lib/config-diff.ts` uses it for the `workflows` type: "Adds the step Check owner after Load", "Update now takes its stage from a fixed value", "Now starts when a deal's stage changes". The draft pill and the review page (`routes/_app/config.drafts.$id.tsx`) show these instead of today's field-by-field fallback.
  - **Needs:** WE.06.
  - **Done when:** tests cover each kind of change; in the browser a draft that adds a step reads as one line on the review page.

- [ ] **WE.25 The Changes tab** [web]
  - Draft against live in the outline itself: added, removed, moved and changed steps marked with a word and an icon, removed steps shown in place, and a changed step's detail showing before and after. The plain-English list sits above it.
  - **Needs:** WE.24.
  - **Done when:** in the browser a draft that adds one step and changes another shows both marked, and a screen reader hears "added" and "changed".

- [ ] **WE.26 `config_history`** [API]
  - Row 12, with `GitService.log`. Works for any config file, so choice lists, roles and P2.10d's config history can use it.
  - **Needs:** nothing.
  - **Done when:** against a test remote, two publishes that change a workflow are listed newest first with who published them and their drafts, and a file never published returns nothing.

- [ ] **WE.27 The History tab** [web]
  - Published versions from `config_history`. Opening one shows the workflow as it was (`workflow_get` with `sha`), read-only. Any two versions, or a version and the draft, compare with WE.25's view.
  - **Needs:** WE.25, WE.26.
  - **Done when:** in the browser the version before the last publish opens, and comparing it with live shows what that publish changed.

- [ ] **WE.28 `workflow_test`** [API]
  - Row 13, on P2.22's runner for a running instance. One run of a draft or live definition: rolled back, waits skipped, approvals answered as the input says, external steps faked. An external step with no fake fails the test with a message naming it. The trace is kept as a run with `dry_run` set and the draft's commit as its `config_sha`. The result also comes back as an example case in P2.22's shape.
  - **Needs:** P2.22, WE.01.
  - **Done when:** tests show a test of a draft `deal_move_stage` returns its output and steps, leaves the deal unchanged and no `event_log` row, keeps a dry run, and that a workflow with `http_send` reaches nothing.

- [ ] **WE.29 The Test tab** [web]
  - A form from the workflow's input (`components/workflow-form.tsx`'s fields), or for an event-started one a payload that can be filled from a recent event (`eventLog.list`). Fakes for each external step and an answer for each approval. The result: the output or error, the path taken marked on a copy of the outline in this tab, what it would have changed and emitted, and a link to the trace. **Save as example case** adds the returned case to `cases` in the working copy.
  - **Needs:** WE.14, WE.28.
  - **Done when:** in the browser a manager tests a draft of Move stage to a lost stage with no reason, sees `reason_required` at `check_reason`, and saves it as a case.

- [ ] **WE.30 Example cases in the editor** [web]
  - The workflow's `cases`, each as a form in P2.22's shape, with add, change, remove and Run. Which required cases are missing (one per error, and a wrong caller when the input takes a record) is listed. This closes the last part of the file the editor couldn't change.
  - **Needs:** P2.22, WE.29.
  - **Done when:** in the browser a workflow with no wrong-caller case says so, and adding one clears it.

- [ ] **WE.31 Runs by step** [API] [web]
  - Row 14, and a link on each step's detail: "Runs that reached this step" and "Runs that failed here", into Activity → Workflow runs.
  - **Needs:** WE.10.
  - **Done when:** a test filters runs by a failed step, and the link from `check_reason` lists the runs that failed there.

### Phase 4: the agent sidebar

- [ ] **WE.32 Page context** [web]
  - `lib/page-context.ts` and a hook each screen calls: the route, what is open (a workflow, a record, a draft), the version, the draft id, the selected step and field, and whether there are unsaved edits. One place the sidebar reads it from; the dev bar's Inspect menu shows it. The editor, the record screens and the draft review page set it.
  - **Needs:** WE.06.
  - **Done when:** tests cover the context for each screen; in the browser the dev bar shows the selected step changing as it is selected.

- [ ] **WE.33 Links that show something** [web]
  - Every step, field, tab and version has a URL. `lib/app-links.ts` builds and checks them, refusing anything outside the app. Arriving on one scrolls to the target, opens its branch and form, moves focus there and marks it without relying on motion. The sidebar turns an app link in the agent's reply into a "Show me" button.
  - **Needs:** WE.32.
  - **Done when:** tests cover building and refusing links; in the browser a link to a field in a collapsed branch opens to it with focus on the field.

- [ ] **WE.34 The agent's edits, shown** [web]
  - When the draft file changes under the open page and the last save was the person's agent (`at.saved_by` from `workflow_get`), the page says so, shows what changed with WE.25's view against what the person had, and offers Keep or Undo (a save of the earlier content). Unsaved edits are never thrown away: the person compares first.
  - **Needs:** WE.22, WE.25.
  - **Done when:** in the browser an agent's save over MCP into the open draft shows as "Claude changed this workflow", the changed step is marked, and Undo puts it back.

- [ ] **WE.35 A guide for agents** [docs] [API]
  - The MCP server's instructions (`packages/server/src/mcp.ts`) and a short guide say how to build a workflow: `action_list` and `event_list`, `workflow_get`, `workflow_validate`, `draft_save` with a revision, `workflow_test`, publish. The same steps the editor takes.
  - **Needs:** WE.28.
  - **Done when:** Claude Code, given only the MCP server, adds a step to a CRM workflow in a draft, tests it and asks for approval, and the person sees it in the editor.

## Accessibility and consistency

These hold for every web task; a task isn't done if it breaks one.

- **Keyboard:** everything the pointer can do. Moving a step is a command, never only a drag.
- **Screen readers:** the outline is nested lists; each row's name says its place, kind and state ("Step 3 of 5, Update the deal, action, 1 problem"). Changes are announced.
- **No meaning by colour alone:** problems, warnings, cuts, added and removed each have a word and an icon.
- **Reduced motion:** nothing moves to show a change when the system asks for less motion.
- **Narrow panes:** laid out by the pane's width, since the agent sidebar takes up to 36% of the window.
- **The same parts as other screens:** `PageHeader` with the trail Workflows › the workflow, `staticData: { section: "automation" }`, `ErrorText`, the working-draft pill, and components from `packages/ui`. No new dependency in this plan.

## Log

- 2026-11-10 · plan · Written from Dylan's brief for the visual workflow editor. Decisions 0053 to 0058 proposed.
- 2026-11-10 · WE.00 · [#101](https://github.com/deagil/factory/pull/101) · Decisions 0053 to 0058 accepted. P2.23 split into P2.23a (the run inspector, reusing WE.06's outline) and P2.23b (the read-only workflow view, done by WE.04 to WE.10); P2.10f and P2.30 need P2.23a only. Step labels stay off the file until WE.10a looks again, after phase 1. The five value-building actions are WE.17a, straight after WE.17. Schedules stay UTC in the file and are shown with the viewer's local time beside them.
- 2026-11-10 · WE.01 · [#105](https://github.com/deagil/factory/pull/105) · `workflow_list` and `workflow_get` are the core's first code workflows, one read-only step each (`packages/workflows/src/code.ts`). A draft or a sha is read through `ctx.git`, which steps now receive; a file's revision is its git blob id. `check` includes the scopes from WE.02. Without a config remote, those inputs are refused and a config workflow is not editable.
- 2026-11-10 · WE.02 · [#102](https://github.com/deagil/factory/pull/102) · `validateWorkflow` returns `scopes`: per step path, the steps whose output it may read; each step's output JSON Schema once; input and event fields as `describeWorkflowField` describes them, so a choice field carries its list, options and columns. A catalog event with no field list is `eventSchema`. Not wired into `workflow_get` (WE.01). The workflow's own output is recorded at the path `output`.
- 2026-11-10 · WE.03 · [#103](https://github.com/deagil/factory/pull/103) · `action_list` and `event_list` are read-only code workflows, granted to the CRM's manager as well as admin. Output is `{ actions }` and `{ events }` because a workflow's output is a mapping. `draft_id` is text on the endpoint (workflow fields have no uuid) and the action requires a uuid. A generated record event (`deal_updated`) comes from its object. `ctx.git` is passed into workflow steps so a draft can be read. Register further code workflows beside `actionEventWorkflows` in `defineSystem`.
- 2026-11-10 · WE.12 WE.13 · [#104](https://github.com/deagil/factory/pull/104) · `draft.save` takes a file revision and refuses a stale one, only the draft's owner may save into it, and a save by value keeps the comments and lines it didn't change. `draft.files` returns each revision, and `draft.mine` returns `headSha`.

## Answers

Dylan, 2026-11-10. Each question is settled on the recommendation.

1. **Who may read a workflow's steps.** Roles that name `workflow_get` and `workflow_list`. The CRM gives both to admin and manager.
2. **P2.23.** Split into P2.23a (the run inspector) and P2.23b (this plan's phase 1). P2.23a reuses the outline from WE.06.
3. **New operations.** Code workflows now. WE.01 is the core's first.
4. **Step labels.** Not now. A row is read from the step's id and what it does. An optional `label` on each step (which would amend decision 0048) is looked at again in WE.10a, right after phase 1, with real workflows on screen. No schema change until then.
5. **Comments.** A save keeps the comments it did not change (WE.13).
6. **Who may test.** Roles that name `workflow_test`, given to few. Every test is a dry run on record. Hiding real tables from the test transaction waits until testing is given to many people.
7. **The File tab.** A plain text area, with problems listed by line. No editor library.
8. **Moving steps.** Commands and the keyboard. No dragging.
9. **The in-app agent's draft.** It saves into the person's draft when the page context names that draft. Every other agent uses its own.
10. **Building a value from parts.** Five internal actions, the same closed set as computed fields (decision 0052): join text, the first value that is present, add, subtract and multiply. That is WE.17a, straight after WE.17. Not a template inside a fixed value.
11. **Schedules.** Shown in UTC with the viewer's local time beside. The file is unchanged.
12. **When live and a draft both change a file.** The person picks theirs or live for the whole file. Nothing is merged inside a file.
