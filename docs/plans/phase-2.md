# Phase 2: Config over git

**Goal:** staff change how a system behaves without a deploy. Choice fields, roles, approval rules, workflows and email templates are files under `config/`, validated against the running code. Staff edit them in drafts that publish as one git commit, and the running system loads them within seconds. Every object has REST endpoints, and role rules on endpoints, fields and rows decide who may use them. Business processes are workflows: steps that run typed actions, published only after validation, passing tests and a second person's approval, and then live as endpoints like any hand-coded route, running under the service key with every call traced. At the end, a sales manager adds a deal stage and a workflow that emails for it in one draft, an admin approves it, and the next deal moved to that stage sends the email, with every step in the run's trace.

**Out of scope:**

- Hosting, releases to `production` from a real remote, the release bot and client SSO (phase 3). Phase 2 publishes to a `production` branch of a local or test remote.
- Team row scopes and rules on related records, per-workflow grants, the page builder, reports and the in-app agent (later).
- Replaying recent real traces against drafts, Playwright tests generated per workflow as a publish gate, and side-by-side rollout of a new workflow version (later; see the publish gate decision below).
- Payments, ledgers, append-only objects and other modules beyond comms (later). `payment_make` is used below only as the example of a workflow with pauses; tests build it from fake actions.
- A CLI generated from the registry (later; the registry makes it a surface like the others).

## Resume here

- **Status:** in progress. P2.01 to P2.14 are done: systems have their own migrations (decision 0036), agents see action ids, and config is YAML files with registered types (decision 0037), checked by `validateConfig` in `fx ship` and CI, and loaded live by the config loader (decision 0038). `f.choice` checks values against `config/choices/`, and each list's columns and any fixed keys are defined in code with `defineChoiceList` (decisions 0039, 0040). The CRM has organisations, contacts and deals; `deal.stage` is a mapped choice, a deal starts in an open stage, and `deal.moveStage` is the only way to change it. With a `configRemote`, the server reads config from a git remote's production branch, and drafts change it: one commit per publish, copied to main (decision 0041). Approval rules in `config/approvals/` park a matching action until the last approval runs it (decisions 0042, 0043). Each person has a working draft, shown as a pill in the header, that publishes or asks for approval (decision 0044).
- **The model changed on 9 Nov 2026.** After a design review, actions stop being endpoints: objects get REST endpoints, and published workflows are the only other endpoints, made of steps that run actions. P2.11 wrote it into decisions 0045 (endpoints, actions, workflows, roles, approvals and the publish gate), 0046 (runs, segments and errors) and 0047 (snake_case names), SYSTEM_DESIGN and AGENTS.md. **The model** below is the summary; the decision records are the reference.
- **Next task:** P2.15, actions as what steps run, then P2.16 on in order; P2.13a (snake_case field keys) can go any time before P2.24. Every call now writes a run with one step (P2.12), every object answers on REST (`/deals`, `/deals/{id}`, `/deals/{id}/history`) beside `/actions` and `/queries` (P2.13), and roles give per object endpoints, `rows: own | all` and field lists, plus workflows by name (P2.14; SYSTEM_DESIGN §4.3). Hand-written actions still write with full access, as workflows will. P2.10d to P2.10f wait for workflow endpoints; their **Needs** say which.
- **How to start:** see [docs/plans/README.md](README.md) and AGENTS.md. Every change goes through `pnpm fx start` → `pnpm fx ship` → `pnpm fx done`. `pnpm fx describe` shows what the CRM has.
- **Carried over from phase 1:**
  - drizzle-kit can't tell a rename from a drop and an add without a terminal, and 0.31 re-adds `actor_roles`' primary key on every push. See [phase-1-handover.md](phase-1-handover.md) for these and the other traps.

## Decisions for this phase

These fill gaps until later phases replace them. Don't build further than this.

- **The config remote is any git remote.** Tests and local development use a bare repository on disk; phase 3 points it at the client's real remote. The config service uses plain git commands, not a GitHub API.
- **Locally, `config/` is read from the working tree** and reloaded on save, with no git involved, as SYSTEM_DESIGN 4.4 says. Drafts are exercised against a bare test remote, or by hand with `CONFIG_REMOTE=local`, a bare repository in `.factory/` made from `config/`.
- **The bot that copies a publish from `production` back to `main` is a function the config service calls after the merge,** not a separate service. Phase 3 moves it to wherever releases run.
- **Email goes to a dev sink locally:** `comms_send` prints the message to the server console, the same way sign-in codes are printed. A real provider comes with hosting.
- **Workflows run in the API process** with DBOS on the same Postgres. A separate worker is a phase 3 question.

### The model (agreed 9 Nov 2026; written up by P2.11)

**Principles.** Simple, consistent, robust: a few strong building blocks used the same way everywhere. One way to do each thing. Each capability is defined once and appears on the API, MCP, the CLI (later) and the web app with the same behaviour, the same permission check and the same trace. People can open any workflow or run and understand it visually, though agents do most of the building. Plain words over jargon.

**Words.** A **step** is one place in a workflow: it runs an action or is control flow. An **action** is reusable typed code a step runs; it is internal or external. A **run** is one call of an endpoint, and a **run step** is the record of one step in it. A **segment** is the steps of a run that commit together. The **trace** is a run and its run steps. A **retry key** makes a repeated call or step act once.

**Names.** Everything is snake_case, and a thing has the same name everywhere: file, URL, MCP tool, config key, event and trace. `deal_move_stage` is `config/workflows/deal_move_stage.yaml`, `POST /workflows/deal_move_stage` and the MCP tool `deal_move_stage`; it emits `deal_stage_changed` and runs actions such as `deal_update`. The same goes for objects, fields, events, actions, roles and choice lists (`deal_stages`). Names needn't start with an object (`month_end_close` is fine); starting with the object a workflow acts on is a convention that groups them, not a rule. Object endpoint paths use the object's plural (`/deals`).

**Endpoints.** The only endpoints are object endpoints and workflow endpoints. A caller's role is checked once, at the endpoint.

- **Object endpoints** are generated by `defineObject` for every object, with no opt-in. Each is the object's generated action of the same name, run as a one-step run.

  | Endpoint | Does | MCP tool |
  | --- | --- | --- |
  | `GET /<objects>` | List, with query parameters to filter, sort and page (a cursor) | `<object>_list` |
  | `GET /<objects>/{id}` | Read one record | `<object>_get` |
  | `POST /<objects>` | Create | `<object>_create` |
  | `PATCH /<objects>/{id}` | Update the fields given. `If-Match` carries the version for optimistic concurrency. There is no `PUT`: one way to update. | `<object>_update` |
  | `POST /<objects>/{id}/archive`, `/restore` | Hide a record from lists, or bring it back | `<object>_archive`, `<object>_restore` |
  | `GET /<objects>/{id}/history` | The record's field history and the runs that touched it | `<object>_history` |

  The error shape, request ids and auth stay as decision 0027 has them. Owned fields (`actions.update.readOnly`) go: role rules decide who writes a field.

- **Workflow endpoints:** a published workflow that starts when called is `POST /workflows/<name>`, with the same input, output and errors a hand-coded route would have. A workflow whose steps only read is marked `read_only: true`, is served as `GET /workflows/<name>` with query parameters, and validation proves it never writes. Runs are resources: `GET /runs/{id}`.
- **Every surface comes from one registry.** HTTP and OpenAPI, MCP (one tool per endpoint, named exactly as the endpoint), `system_describe`, and the web app's screens, forms and workflow buttons. The CLI joins later. Agents build workflows through the same endpoints the web app uses. Actions are never on a surface.

**Roles.** One set of rules, the same on every surface. Routes never carry rules of their own.

- **Endpoints:** which object endpoints and workflows a role may call. A workflow is granted by name like an object endpoint.
- **Fields:** which fields a role may read and which it may write, per object. Lists and reads leave out unreadable fields; a write to an unwritable field is refused with a validation error naming the field.
- **Rows:** `own` or `all`, applied to lists, reads and writes. `own` means the record's owner field (declared on the object, for example `owner: "owner"` on deal) is the caller, or for an agent, the person it acts for. Team scopes and rules on related records come later.
- **Example:** senior back-end staff can `GET` most payments, and no role can `POST /payments`. Payments are made only through the `payment_make` workflow.
- **Privilege ceiling:** nobody grants, mints or revokes a role or key with authority they don't hold themselves (review decision, P1 priority).

**Actions** are what steps run: code, defined with `defineAction`, with Zod input and output, declared error codes and their own unit tests. Each one either fully happens or doesn't. Actions are internal and never on a surface; modules and systems add their own. Each action is one of two kinds, and that is all segments need to know:

- **Internal:** only touches our own database, so a rollback undoes it if a later step fails. Examples: the generated record actions for each object (`deal_get`, `deal_list`, `deal_create`, `deal_update`, `deal_archive`, `deal_restore`); ready-made checks such as "record belongs to caller", "within limits" and "record is in the expected state"; calculations and reshaping; later, balanced ledger postings. An internal action gets the segment's repository and never opens its own transaction.
- **External:** reaches another system, which a rollback can't undo. Examples: `http_send`, `comms_send`, later a payment provider. It runs outside the transaction, with a retry key and retries.

**Steps** are either an action or built-in control flow, which the engine provides and nobody writes: `if` (condition and branch), `wait`, `wait_for_approval`, `run` (another workflow), `emit`, `fail` and `output`. The two waits are the pauses.

**Workflows** are where business processes live.

- Client processes are YAML under `config/workflows/`, shown visually. The core and modules define theirs in TypeScript with `defineWorkflow`, in the same shape, run by the same engine, served on the same endpoints and traced the same way. So the draft, approval, actor, API key and invite operations become code workflows (`draft_publish`, `approval_approve`, `actor_set_roles`, `api_key_create`, `user_invite`, …), and `system_describe`, `record_history`, `config_validate` and the log reads become read-only code workflows.
- **Started** when called (returning data like a route), when an event happens, or on a schedule (`starts_when`).
- **Input and output.** `input` at the top of the file defines what the workflow takes, with the same field types as objects. The endpoint checks it before any step runs, and it is also the web form, the MCP tool's schema and the OpenAPI request. Steps read it as `input.<field>`, an event-started workflow reads `event.<field>`, and a step reads an earlier step's result as `steps.<id>.output.<field>`. `output` says what the caller gets back.
- **Checks are steps.** Any check you'd write in route code ("this account is mine") is a step that fails with an error code the workflow declares, in `errors`, with a plain-English message. OpenAPI and MCP list them.
- **Nested:** a step can run another workflow. The parent waits for its result; if the child fails, that step fails.
- **Example, moving a deal's stage:** by default it's a plain `PATCH`, governed by role rules like any field. When the business needs checks (a lost stage needs a reason), roles get no write on `stage` and a published `deal_move_stage` workflow does it with check steps and emits `deal_stage_changed`. A sketch of the file (P2.16 settles the format):

  ```yaml
  name: deal_move_stage
  description: Move a deal to another stage. A lost deal needs a reason.
  starts_when: called
  input:
    deal: { type: ref, object: deal }
    stage: { type: choice, list: deal_stages }
    reason: { type: text, optional: true }
  errors:
    reason_required: A lost deal needs a reason.
  steps:
    - id: load
      action: deal_get
      with: { id: { from: input.deal } }
    - id: check_reason
      if:
        - { field: input.stage.category, is: lost }
        - { field: input.reason, is: empty }
      then:
        - fail: reason_required
    - id: update
      action: deal_update
      with:
        id: { from: input.deal }
        stage: { from: input.stage }
        lost_reason: { from: input.reason }
    - id: announce
      emit: deal_stage_changed
      with:
        deal: { from: input.deal }
        from: { from: steps.load.output.stage }
        to: { from: input.stage }
  output:
    deal: { from: steps.update.output.record }
  ```

**Running.**

- **Service key.** Inside a workflow, actions run with full internal access, like a code API running with its database rights. Getting each step right is the workflow's job; publishing (below) is the control. The run records the caller as `origin_user_id` and the workflow as the actor.
- **Segments: steps between pauses commit together.** The engine opens a transaction and runs consecutive internal steps in it. At a pause, or an external step whose output is used, it commits, checkpoints (DBOS), runs the step, checkpoints its result, and opens a new transaction. It's automatic: nobody marks segments, and the file has no setting for them. A run with no pauses is fully atomic. Dependencies between steps don't matter; a later step sees an earlier one's writes. Branches cut only on the path taken; a child workflow with no pauses joins its parent's transaction. The editor shows where a cut may happen and the trace where it did. Checkpoints are per segment, not per step.
- **External steps whose output no later step uses** (a notification email, a webhook) are queued in the segment and sent after it commits, like `event_log`, so they don't cut it and a rolled-back run sends nothing.
- **Retry keys.** "Retry key" is the name everywhere people and agents read it: docs, the web app, config and traces. A step's retry key is the run id plus the step id. On the wire it travels in the standard `Idempotency-Key` header, because that is what other systems and HTTP tools recognise: external steps send it (and `http_send` lets the workflow file name a different header when a destination needs one), and a caller sending it to a workflow endpoint gets the earlier run back.
- **Errors in a run with no pauses:** everything rolls back and the caller gets the typed error at once (validation, permission, not found, conflict, or the workflow's own codes such as `reason_required`). The trace is written outside the transaction, so it survives.
- **Errors after a commit:** the failing segment rolls back and earlier segments stay. Temporary errors from external steps are retried with backoff and the same retry key. A permanent error runs the step's or segment's `on_failure` steps (for example `payment_reverse`) as a new segment. Validation refuses a step that can fail after a committed segment unless it has `on_failure` steps or says `on_failure: leave`. With no way out, or failing `on_failure` steps, the run is marked `needs_attention` in the inbox of the role the workflow names, where someone can retry from the failed step, run the failure steps, or mark it resolved, all traced.
- **Records can change between segments.** A later segment re-reads what it relies on with the ready-made expected-state check (`settle` checks the payment is still pending).
- **What a caller gets:** the endpoint waits until the run finishes or reaches its first pause; an external step is waited for up to a timeout. Finished: the output. Still running: `202` with the run as a resource and `Location: /runs/{id}`. A run waiting for approval is that pending resource, so `approval_required` is no longer an error.
- **Depth limit** on nested and event-started runs, as before.

**Events.** Object endpoints and the generated record actions emit generated events (`<object>_created`, `<object>_updated` with the changed fields and before and after, `<object>_archived`, `<object>_restored`) in the segment's transaction. A workflow may also declare its own events with payload schemas and emit them with an `emit` step (`deal_stage_changed` with the stage's category). Event triggers can test the payload, including changed fields and a choice field's column such as `stage.category`. Workflows are the only listeners; one dispatcher starts one run per event and matching workflow, exactly once.

**Approvals.**

- **Data needs sign-off only through a workflow.** If a write needs approval, roles don't get that write and a workflow does it with a `wait_for_approval` step (approver role, number of approvals, requester and exempt roles, and conditions, from decision 0043). The CRM's archive rule becomes an `organisation_archive` workflow.
- **Approval rules in `config/approvals/` cover config drafts only.**
- **Two people** for any draft that touches `workflows/`, `roles/` or `approvals/`: the author and at least one different person with the approver role. There is no admin exemption for these.
- One approvals table and one inbox for both. A request is a run waiting at a step, or a draft.
- **Developer-written workflows** reach `main` through `fx ship` and a PR. CI runs their example cases and the PR review is the second person.

**The publish gate.** Every new or changed workflow starts as a draft and publishes only after:

1. **Validation on save:** step inputs and outputs line up; the actions, fields, choice options and events it names exist; branches cover every outcome; `on_failure` steps exist where they must; `http_send` URLs are fixed in the file, never from data; a warning when a workflow takes a record id with no ownership check.
2. **Example cases,** under `cases` in the workflow's own file (or `defineWorkflow`): a caller, an input or event, fixture records, recorded fakes for external steps, and the expected output or error, writes and emits. Failing cases are required: one per declared error code, and a wrong-caller case when the input takes a record. In CI they run against a database built from migrations; in a running instance, inside a transaction that is always rolled back, with waits skipped and approvals and external steps faked.
3. **Regression:** every workflow's cases rerun in CI whenever a workflow, action, object or the core changes.
4. **Two-person approval,** as above.

**Runs replace `action_log`.** Actions never write logs themselves: each step hands back its output or error, and the engine is the only writer of the trace. Every endpoint call is a run: one `runs` row (endpoint, actor, origin user, input, output or error, status, retry key, config sha, parent run, triggering event, timings) and one `run_steps` row per step (action or control, segment, input, output, error, branch taken, timings). An object endpoint call is a run with one step. Changed data isn't copied into steps: `audit_log` already holds each field's before and after, and with `event_log` carries `run_id` and `step_id`. Approvals point at the run (or the draft). Steps are rows, not an array on the run, so history can point at the exact step, runs can be searched by step ("failed at check_limits"), a run that waits for days isn't rewritten as it grows, and a retried step keeps its earlier attempt. The logs stay append-only.

**What stays.** The pipeline's stages (identify, validate, retry check, authorise, run, record, commit) move to the endpoint; retry keys, dry runs (as the base for example cases), choice fields, config drafts over git, the loader and validation, Better Auth, the error shape and stateless MCP all carry over.

**Open, not in this phase:** how team scopes and related records work; whether to have a protected owner role; the licence; API key policy; the admin approver exemption outside workflows, roles and approvals.

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

- [x] **P2.08 Drafts over git**
  - Actions `config.draft.open`, `config.draft.save`, `config.draft.submit` and `config.draft.publish`. Open branches from `production`; each save commits one file and validates the whole set; publish merges into `production` in one commit and the bot copies it to `main`. Drafts are tracked in a new table.
  - **Needs:** P2.05.
  - **Done when:** against a bare test remote, a draft that edits two files publishes in one commit, the loader picks it up, and `main` has the same commit's changes.

- [x] **P2.09 Approval rules**
  - An `approval` config type: which action, an optional condition (field, operator, value; no expressions), and who approves. The pipeline's approve stage finds matching rules, writes a `pending_approval` row and returns `approval_required`. `approval.approve` and `approval.reject` run or close the pending action, once.
  - Drafts whose files an approval rule covers wait for approval before they publish.
  - **Needs:** P2.05.
  - **Done when:** a rule on `organisation.archive` makes a sales user's archive wait until an admin approves, and approving runs it exactly once with both people in `action_log`.

- [x] **P2.10 Drafts and approvals in the web app**
  - Config editors for choices and roles, built from the config types' schemas; a draft view with a plain-English diff; an approvals inbox for pending actions and drafts.
  - **Needs:** P2.07, P2.08, P2.09.
  - **Done when:** in the browser, a manager adds a deal stage in a draft, an admin approves it, and the new stage appears in the deal form after publish.

### Config and approvals where staff expect them (decision 0044)

P2.10 made drafts and approvals their own screens, which follow git rather than how staff work. These tasks let staff change a setting where it is, see that they have unpublished edits, and publish them, with approval happening along the way; and let people who asked for approval follow and withdraw their requests.

- [x] **P2.10a Working drafts and requests**
  - One working draft per actor (`draft.mine`; `draft.save` without an id opens it), titled from its files. `draft.revert` and `draft.discard`.
  - `draft.publish` asks for approval when a rule covers the draft, and the last approval publishes it as the person who asked; `draft.submit` goes. `approval.withdraw`, `approval.check`, and `approval.list` filters for mine, decidable and a record.
  - **Needs:** P2.10.
  - **Done when:** against a bare test remote, a person's saves land in one draft they can undo or discard; an agent's publish waits and the last approval publishes it as the agent; a sales user sees beforehand that an archive needs an admin, and can withdraw it.

- [x] **P2.10b The draft indicator and review page**
  - A header pill for the caller's working draft (unpublished edits, waiting for approval, or problems) with a popover listing each edit in plain English, Undo, Publish (or "Request approval from …"), Discard and Review.
  - The draft page becomes a review page: title, edits, problems, approval progress, Publish, Withdraw and Discard. Editing a draft that waits for approval warns that it withdraws the request.
  - **Needs:** P2.10a.
  - **Done when:** in the browser, a manager's edit shows in the pill, and they publish or request approval from it without visiting a drafts list.

- [x] **P2.10c Choice lists edited in place**
  - Settings → Choice lists: each list, the fields that use it, and its live options, with Edit saving into the working draft. Edited rows are marked, and the live version is a toggle away. Choice selects link to "Manage options" for people who can edit.
  - **Needs:** P2.10b.
  - **Done when:** in the browser, a manager adds a deal stage from the deal stages page and publishes it from the pill.

P2.10d to P2.10f are below, under **Staff screens on the new model**: they wait for role rules and workflow endpoints.

### Write the model down

- [x] **P2.11 Decision records and design docs**
  - A new decision record for the model in **Decisions for this phase**, one for runs, segments and errors, and one for names (snake_case everywhere, the same name on every surface). Mark as superseded, with a link, and rewrite where they still apply: 0001 (endpoints come from objects and published workflows; actions are internal), 0010 (workflows are endpoints as well as listeners; a step runs an action or is control flow), 0011 (service key, the publish gate and two people instead of derived permissions), 0022 (generated actions become REST endpoints and internal record actions), 0024 (role rules on endpoints, fields and rows), 0027 and 0028 (routes and tools, named as the endpoint). Amend 0020 and 0021 (the pipeline runs at the endpoint; a step's retry key is the run id plus the step id; "retry key" in prose, `Idempotency-Key` on the wire; dry runs back example cases), 0026, 0029, 0030, 0042 and 0043 (rules cover config drafts; the rest moves to `wait_for_approval`). Check 0044 still fits.
  - SYSTEM_DESIGN: the core tables (section 3), 4.2, 4.3, 4.6, 4.7, 4.8, 4.9, the walkthroughs in section 5 and the glossary (step, action, internal and external, workflow, published workflow, service key, segment, run, run step, trace, retry key; query retired). AGENTS.md: the current state, rules 1, 11, 12 and 13, and the naming section.
  - Docs only.
  - **Needs:** nothing.
  - **Done when:** the records are merged, SYSTEM_DESIGN and AGENTS.md describe the model with no leftover rule that contradicts it, and the glossary defines every term the later tasks use.

### Runs, object endpoints and role rules

- [x] **P2.12 Runs replace `action_log`**
  - New `runs` and `run_steps` tables, as **The model** describes them. The pipeline writes a run with one step for every call it makes today; `audit_log` and `event_log` get `run_id` and `step_id`; approvals and `drafts.publish_action_id` point at the run; the retry-key index moves to `runs` (actor, retry key).
  - The log reads (`actionLog.*` today) and Activity → Actions read runs, renamed Runs. `action_log` stops being written; dropping it is the marked contract step in P2.26.
  - **Needs:** P2.11.
  - **Done when:** every existing test passes on runs, the contract tests compare run and step rows across HTTP and MCP, and Activity shows a run with its step.

- [x] **P2.13 Object endpoints and snake_case names**
  - `defineObject` generates the REST endpoints in **The model** for every object, through the same pipeline, beside `/actions` and `/queries`, which stay until P2.26. List filters, sort and cursor are query parameters; `PATCH` takes `If-Match`; history is `GET /<objects>/{id}/history`.
  - Names move to snake_case: generated actions and their MCP tools (`deal_create`), generated events (`deal_updated`), choice lists (`config/choices/deal_stages.yaml`) and other config keys, with `validateConfig` refusing other shapes. Hand-written actions keep their names until P2.24 and P2.25 replace them.
  - OpenAPI groups operations by object. MCP has one tool per endpoint, named as the endpoint. `system_describe` lists object endpoints. The web app's object screens (list, record, new, history) move to the REST endpoints.
  - **Needs:** P2.12.
  - **Done when:** the CRM's objects answer on REST over HTTP and MCP with snake_case names, the contract tests cover every generated endpoint, the web app's record screens use them, and `/actions` still works.

- [ ] **P2.13a snake_case field keys**
  - Decision 0047 covers fields, and P2.13 left them camelCase (`firstName`, `expectedClose`, `createdAt`). `defineObject` refuses other shapes; the housekeeping keys (`created_at`, `created_by`, `archived_at`, `custom_fields`, `next_cursor`) follow, through records, list filters and sort, history, events, the OpenAPI document and the web app. Columns already are snake_case, so no migration.
  - **Needs:** P2.13.
  - **Done when:** the CRM's records, filters and events use snake_case keys on every surface, and a camelCase field key fails `defineObject` with a clear message.

- [x] **P2.14 Role rules on endpoints, fields and rows**
  - A new role file shape: per object, the endpoints a role may call, the fields it may read and write, and its rows (`own` or `all`); workflows granted by name. `defineObject` takes `owner` to name the owner field. `validateConfig` checks it against the catalog. The CRM's roles move to it.
  - Applied in the data access layer for every read and write on every surface: lists and reads are filtered by rows and leave out unreadable fields; writes to unwritable fields and to rows outside scope are refused with a typed error naming the field or record. `system_describe` gives each field's read and write for the caller, and the web app's forms follow it. `actions.update.readOnly` goes.
  - The privilege ceiling: setting roles, creating agents and integrations, inviting people and creating or revoking API keys refuse to grant, mint or revoke what the caller doesn't hold.
  - **Needs:** P2.13.
  - **Done when:** a role without write on `deal.stage` can't change it over HTTP, MCP or the web app; a role with `own` on deals lists, reads and updates only its own; a manager can't give someone the admin role; and a role file naming an unknown field fails validation with file and line.

### Workflows (`@workspace/workflows`)

- [ ] **P2.15 Actions as what steps run**
  - `defineAction` takes a `kind` (`internal` or `external`) and declared error codes, with Zod input and output, and a test helper that runs an action against a test database. Internal actions receive the segment's repository with the service key; external ones run outside it with a retry key. The registry keeps actions off every surface; the actions written before this task stay on `/actions` until P2.26, and the ones it adds are never reachable.
  - Generated internal record actions for every object (`<object>_get`, `_list`, `_create`, `_update`, `_archive`, `_restore`). Ready-made checks: record belongs to caller (the object's owner field), within a limit, and record in an expected state (field equals or is one of). `fx describe` lists actions with their kind and schemas.
  - **Needs:** P2.13.
  - **Done when:** the generated and check actions exist with unit tests, a test proves the new ones aren't reachable over HTTP or MCP, and `fx describe` shows each action's kind.

- [ ] **P2.16 Workflow definitions and validation**
  - A `workflow` config type, `config/workflows/<name>.yaml`, and `defineWorkflow` in TypeScript taking the same shape, as in **The model**'s sketch: `name`, `description`, `starts_when` (called, an event with conditions, or a schedule), `input` from field types, `output`, `errors` with messages, declared events, the role whose inbox gets runs needing attention, `read_only`, `cases` (run by P2.22), and `steps`. A step runs an `action` or is `if`/`then`/`else`, `wait`, `wait_for_approval`, `run` (another workflow), `emit`, `fail` or `output`. Values are `from` a path (`input.…`, `event.…`, `steps.<id>.output.…`) or a `value`; conditions are field, operator, value, with no expression language. `on_failure` is a list of steps or `leave`.
  - Validation, as in **The model**'s publish gate step 1, with errors naming the file, the path and line, in plain English. `workflow_validate` also returns the segments: where a cut may happen.
  - **Needs:** P2.15.
  - **Done when:** a YAML `deal_move_stage` and a TypeScript `payment_make` built from fake actions validate; a step whose input type doesn't match, an unknown action, a missing `on_failure` after a commit and an `http_send` URL taken from `from` each fail with a clear message; and `fx describe` lists each workflow with its segments.

- [ ] **P2.17 The runner, for runs with no pauses**
  - Interprets a definition (pinned with the run's config sha) under the service key: consecutive internal steps in one transaction, `if` branches, nested workflows joining the parent's transaction, `emit`, `fail` with declared errors, and `output`. The engine writes `runs` and `run_steps` for the trace outside the transaction from what each step hands back, so a failed run keeps its trace; it records the caller as origin user and the workflow as actor. Any error rolls everything back.
  - Measures `deal_move_stage` as a workflow against today's `deal.moveStage` action and records the numbers in the log.
  - **Needs:** P2.16.
  - **Done when:** in a test, `deal_move_stage` moves a deal and emits `deal_stage_changed` in one transaction; a lost stage with no reason returns `reason_required` and changes nothing; a failing nested workflow fails its parent; and the trace shows each step, its input and output and the branch taken.

- [ ] **P2.18 Workflow endpoints everywhere**
  - `POST /workflows/<name>` (and `GET` for `read_only`), `GET /runs/{id}`, a retry key in `Idempotency-Key` returning the earlier run, and `202` with `Location` for a run still going. A tool per workflow on MCP, named as the workflow, operations in OpenAPI with the declared errors, and workflows the caller may call in `system_describe`. Roles grant workflows by name (from P2.14).
  - The web app shows a workflow whose input takes a record of an object as a button on that record, with a form from its `input`, and the rest from a Workflows page. The `<object>.<verb>` custom-action buttons stay until P2.26.
  - **Needs:** P2.14, P2.17.
  - **Done when:** `deal_move_stage` runs from HTTP, MCP and a button on the deal with the same run rows, a lost stage without a reason shows the declared message on each, and the contract tests cover workflow endpoints.

- [ ] **P2.19 Events and the dispatcher**
  - `packages/events`: the dispatcher reads new `event_log` rows and starts one run per event and matching workflow, exactly once, with the event's origin user, a parent link to the run that emitted it and the depth limit. Event triggers test the payload, including changed fields and choice columns. Schedules start runs too.
  - **Needs:** P2.17.
  - **Done when:** moving a deal to won runs a workflow that creates a follow-up record; a workflow started by `deal_updated` when `owner` changed runs only for that change; the follow-up's run links back to the move; and a chain past the depth limit stops with a clear trace.

- [ ] **P2.20 Durable runs: pauses, external steps and failures**
  - DBOS checkpoints at segment boundaries; `wait`; external steps run outside the transaction with their retry key in `Idempotency-Key`, retried with backoff on temporary errors; external steps whose output nothing uses are queued and sent after commit; `on_failure` steps as a new segment; `needs_attention` runs with retry from the failed step, run the failure steps, and mark resolved, each traced. The ready-made expected-state check is used across segments. The trace shows segment boundaries and what was undone.
  - **Needs:** P2.17, P2.19.
  - **Done when:** in tests with a fake outside endpoint, `payment_make` survives a server restart during a `wait`; a temporary failure is retried with the same retry key and acts once; a permanent failure runs `payment_reverse`; failing `on_failure` steps land the run in the named role's inbox; and a queued notification is sent only after its segment commits.

- [ ] **P2.21 Approvals as a step, and two people for config**
  - `wait_for_approval` creates a request in the approvals table and the inbox, with the options from decision 0043, and the last approval resumes the run; rejecting runs its `on_failure` steps; withdrawing cancels the run. Checking beforehand who must approve works for a workflow and its input.
  - Approval rules cover config drafts only; rules on actions go. Drafts touching `workflows/`, `roles/` or `approvals/` need the author and one other approver, with no admin exemption, enforced in the core.
  - **Needs:** P2.20.
  - **Done when:** an `organisation_archive` workflow waits for an admin and finishes on approval, survives a restart while waiting, and can be withdrawn by the requester; and an admin's own draft changing a role can't be published without a second admin.

- [ ] **P2.22 Example cases and the publish gate**
  - The `cases` in each workflow, in the shape **The model** describes, with the required failing cases. A runner for CI (database from migrations, run by `fx ship` and the `check`, rerun when a workflow, action, object or the core changes) and for a running instance (one rolled-back transaction, waits skipped, approvals and external steps faked from recordings).
  - A draft with workflows publishes only when validation passes, every case passes and the required failing cases exist, then through P2.21's two people. The review page shows each case's result.
  - **Needs:** P2.18, P2.21.
  - **Done when:** in the browser, a manager's draft workflow with no wrong-caller case is refused with a clear reason; with its cases it passes, and an admin approves and publishes it; and changing an action so a case fails turns CI red.

- [ ] **P2.23 The run inspector and the workflow view**
  - Activity → Runs: a run's steps as a diagram, with segments, inputs, outputs, branches taken, errors, retries and the records touched, and links to parent and child runs. A record's history shows the runs that touched it. Each workflow has a read-only visual view of its definition, showing where it may pause, and each object a "What happens when…" view of the workflows its events start.
  - **Needs:** P2.18, P2.20.
  - **Done when:** in the browser, a deal's history links to the run its move caused, the run shows each step and its segment, and `payment_make`'s view shows its pauses and `on_failure` steps.

### Moving onto the model

- [ ] **P2.24 Core operations as code workflows**
  - The draft, approval, actor, API key and invite operations become `defineWorkflow` workflows with snake_case names (`draft_publish`, `approval_approve`, `actor_set_roles`, `api_key_create`, `user_invite`, …), made of internal and external core actions; `system_describe`, `record_history`, `config_validate`, `role_list` and the log reads become `read_only` workflows. Git work in drafts is an external action, so a publish's push is outside the transaction and checkpointed. Roles grant them by name; the web app calls them on `/workflows`.
  - **Needs:** P2.18, P2.21.
  - **Done when:** every core operation runs as a workflow on every surface with a trace, the existing auth, drafts and approvals tests pass against the workflow endpoints, and no core operation is reachable on `/actions` or `/queries`.

- [ ] **P2.25 The CRM on the model**
  - `deal.moveStage` becomes `config/workflows/deal_move_stage.yaml` with its checks and `emit`; sales lose write on `stage`. Creating a deal in an open stage becomes a role rule plus a field default, or a `deal_create` workflow if that can't express it. `contact.moveToOrganisation` becomes a rule or a `contact_move_to_organisation` workflow. Archiving an organisation becomes the `organisation_archive` workflow with `wait_for_approval`, and sales lose direct archive. Roles gain field and row rules (sales: `own` on deals). The hand-written actions and their tests go; each workflow has its cases.
  - **Needs:** P2.14, P2.19, P2.22.
  - **Done when:** the CRM's three hand-written actions are gone, its tests pass on endpoints and workflows, and `pnpm fx describe` shows its objects, workflows and actions.

- [ ] **P2.26 Remove the action and query endpoints**
  - Remove `/actions/<name>`, `/queries/<name>`, `defineQuery`, the per-action MCP tools and the custom-action buttons; regenerate OpenAPI; update `fx describe`. Drop `action_log` as the marked contract step. The contract tests cover object and workflow endpoints only.
  - **Needs:** P2.24, P2.25.
  - **Done when:** a test proves no action is reachable on any surface, the web app and MCP work end to end on the new endpoints, and the migration check passes with the contract step.

### Comms and calls out (SYSTEM_DESIGN §4.6, §4.10)

- [ ] **P2.27 `defineModule` and comms**
  - `defineModule({ name, objects, actions, workflows, configTypes, events })`, switched on in `defineSystem`. The comms module has an `email_send` object, an `email_template` config type, and a `comms_send` external action that renders a template and sends through the dev sink, recording the send on `email_send`.
  - **Needs:** P2.20.
  - **Done when:** a workflow step sends a templated email after its segment commits; it appears in the console, in the run's trace and in the record's history; and a rolled-back run sends nothing.

- [ ] **P2.28 `http_send`**
  - An external action that posts a signed payload in a standard envelope to a URL fixed in the workflow file, with the step's retry key in `Idempotency-Key` (or a header the file names), retries and backoff, recording the response on the step. Validation refuses a URL from `from`.
  - **Needs:** P2.20.
  - **Done when:** a workflow step calls a local test endpoint and the signature verifies; a step whose response a later step uses cuts the segment, and one whose response nothing uses is sent after commit; and a failing endpoint runs `on_failure` or lands in needs attention.

### Staff screens on the new model (decision 0044)

- [ ] **P2.10d Roles and approval rules edited in place**
  - Access → Roles: a page per role with Edit, New role and the people who hold it, editing the endpoints, fields and rows a role has per object, and the workflows it may run. Settings → Approval rules: each config rule as a sentence, with a form for the config types it covers, the approver, approvals, requester and exempt roles.
  - The Config section goes; published drafts become Activity → Config history, with others' open drafts for admins. Updates decision 0033.
  - **Needs:** P2.10b, P2.14, P2.21.
  - **Done when:** in the browser, an admin edits a role's field rules and an approval rule in place, and a second admin approves the draft.

- [ ] **P2.10e Approvals for requesters and approvers**
  - Workflow buttons and forms say beforehand when a run may wait for approval and from whom, and a run that waits is confirmed as a request, not shown as an error. Records show runs waiting on them, with Withdraw and what the run would change. Runs needing attention appear for their role.
  - The inbox gets a count badge, tabs for Needs me, My requests and Decided, plain-English requests linking to their records and runs, a draft's plain-English diff and its case results, and says why someone can't decide instead of showing the buttons.
  - **Needs:** P2.18, P2.21.
  - **Done when:** in the browser, a sales user archives an organisation through the workflow, sees it waiting on the record and withdraws it; an admin approves another from the inbox's Needs me tab.

- [ ] **P2.10f Home page**
  - What's waiting for the caller (approvals and runs needing attention), their requests and their unpublished edits, with links into their objects.
  - **Needs:** P2.10b, P2.10e, P2.23.
  - **Done when:** in the browser, the home page shows an admin their approvals and a manager their draft.

### The Effect trial (decision 0008)

- [ ] **P2.29 Effect 4 trial** _(time-boxed: two days)_
  - On a branch that is never merged, rebuild the runner (segments, a pause and an external step), one object endpoint, one MCP tool and one workflow in Effect 4. Compare it with the plain TypeScript version on: agent first-time success at small changes (the same three tasks given to an agent on each), lines of code, readability for a newcomer, and unstable Effect APIs touched.
  - Write a decision record with the numbers and a recommendation: adopt inside the core, defer again with a new trigger, or drop. Decision 0008's revisit triggers still apply.
  - **Needs:** P2.20.
  - **Done when:** the decision record is merged and links the trial branch.

### Exit

- [ ] **P2.30 Phase exit demo**
  - In `examples/crm`, a sales manager adds the deal stage "Negotiation" (category: open), a workflow that emails the sales director when `deal_stage_changed` enters it, and its example cases, in one draft from the web app. The publish gate runs the cases; an admin approves; it publishes; the loader picks it up with no restart or deploy.
  - Then a deal moved to Negotiation with the web app's button, and another moved by Claude Code over MCP with `deal_move_stage`, each send the email. A sales user can't `PATCH` the stage directly, and moving to lost without a reason fails with `reason_required` on both surfaces. The run inspector shows each run, its segments and the right origin user.
  - Record any surprises in the log, update AGENTS.md and the README status, set phase 2 to Done in `docs/plans/README.md`, and write `phase-3.md`.
  - **Needs:** all of the above except P2.29.
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
- 2026-11-08 · P2.08 · The actions are `draft.*`, not `config.draft.*`, since names have two segments (decision 0041). Publishing is one squashed commit made by the service, not a merge commit, and the copy to main is skipped when main changed one of the draft's files. The config service drives git with plumbing against a bare clone, so it never needs a work tree, and runs with no global git config. Actions reach it as `ctx.git`, write rows through `ctx.drafts`, and now see `ctx.dryRun`, since a push can't be rolled back; draft actions refuse dry runs. The loader takes a source and reloads after each publish. Surprise: the loader's first version handed every replaced folder back to the source, including the working-tree path it starts from, and the test deleted a package folder before I caught it. The source now only removes folders it checked out, and a test checks it leaves others alone.
- 2026-11-08 · P2.09 · Rules are `config/approvals/<key>.yaml`, on an action (conditions on its input) or on config types for drafts (decision 0042). They don't apply to staff who hold the approver role, so the CRM's admins archive and publish straight away; agents always need a person, which is how the drafts test exercises a draft's approval. The last `approval.approve` runs the pending action in its own transaction, in a savepoint, as the person who asked, updating that action's `action_log` row, so a failure leaves the approval standing and the action marked failed. `approvals` holds the decision itself, so there's no `approval_decisions` table. Sales can now archive organisations, through the rule. Surprise: the contract tests read HTTP's 202 for `approval_required` as a success, since it is `ok` to fetch; they now go by the body.
- 2026-11-08 · P2.10 · The web app gets Inbox (Approvals) and Config (Drafts) sections, each shown when the caller has `approval.list` or `draft.list`. The editors don't parse YAML in the browser: `draft.files` returns each file's value and `draft.save` takes a `value`, which the server writes as YAML, so comments in a file an editor saves are lost. The choices editor reads the list's columns from `system.describe`, which now gives each choice field its `list`; saved options can be archived but not removed, since records hold their keys. The CRM has a `manager` role (sales plus drafts) and Mo Manager. Drafts need a git remote, so `CONFIG_REMOTE=local` makes one in `.factory/` from `config/`. Checked in the browser: Mo added "Negotiation" and submitted, Admin approved from the inbox, Mo published, and the deal form lists the stage between "Proposal sent" and "Won". Surprise: `fx dev` stops when another checkout's dev servers hold its ports (Drizzle Studio's 4983 here); I ran the API and web on 4100 and 3100 instead.
- 2026-11-08 · P2.10a · Added P2.10a to P2.10f after reviewing how staff would expect to change config and follow approvals (decision 0044). `draft.submit` went: `draft.publish` asks for approval itself and parks the same call with `ctx.approvals.park()`, which the last approval resumes like any pending action, so the commit is the requester's. Withdrawn requests get a new action status, `withdrawn`. Queries get `ctx.signOffs` from the pipeline for `approval.check`, so it reads a rule's record the same way the approve stage does. The `decidable` filter needed `coalesce` around its asked-by test: the left joins to `action_log` and `drafts` make it null, not false, for the other subject.
- 2026-11-08 · P2.10b · The header pill reads `draft.mine` and, for its Publish label, `approval.check`; the review page reads `draft.get`, which now returns an invalid draft's problems so they survive a reload. `draft.files` without an id gives the caller's working draft or production's files, so Config → Drafts edits straight away and the first save opens the draft; the New draft form went. Added shadcn's popover to `@workspace/ui`. Checked in the browser on ports 4100 and 3100 with `CONFIG_REMOTE=local`: Mo renamed a stage, the pill offered "Request approval from Admin", Admin approved from the inbox and it published; Admin's own edit offered plain Publish, and Undo and Discard worked. Surprise: `cn` here doesn't merge Tailwind classes, so the popover's own `w-72` beat a plain `w-96`; `sm:w-96` sorts later and wins.
- 2026-11-09 · plan · Reworked from P2.11 on after a design review (9 Nov): object REST endpoints, role rules on endpoints, fields and rows, typed blocks, workflows as endpoints running under a service key, segments (steps between pauses commit together), runs replacing `action_log`, approval as a workflow step with rules only for config drafts, and a publish gate of validation, example cases and two people. **The model** under Decisions for this phase records it; P2.11 writes the decision records. The old P2.11 to P2.18 (derived permissions, decision 0011) are gone; P2.10d to P2.10f now wait for role rules and workflow endpoints. `PATCH` only, no `PUT`, and archive and restore as `POST` sub-resources, to keep one way to update.
- 2026-11-09 · plan · Settled the words and names: "block" became **action** (internal or external, the only distinction segments need), with `wait` and `wait_for_approval` as built-in steps; names are snake_case and identical on every surface (`deal_move_stage` as file, URL and MCP tool), and needn't start with an object; a workflow declares `input` and `output`; "retry key" in prose, `Idempotency-Key` on the wire; run steps stay rows, written only by the engine. P2.13 now renames generated actions, events and config keys; P2.15 changes `defineAction` instead of adding `defineBlock`.
- 2026-11-09 · P2.10c · Settings → Choice lists, for people who can `draft.save`: each list, the fields that use it and its live option count, and a page per list (`/settings/choices/<key>`) that edits it into the working draft with the existing editor. Rows that differ from live are marked New or Edited, and a Your draft / Live toggle shows the live list, which is the draft change's before value (the base the draft was opened from), so no API change was needed. Choice selects link to "Manage options" for the same people. Config → Drafts still edits choice lists until P2.10d removes the Config section. Checked in the browser on ports 4100 and 3100 with `CONFIG_REMOTE=local`: Mo added "Negotiation" (open) from the deal stages page, the pill asked Admin, Admin approved, and the new-deal form listed it before Won.
- 2026-11-09 · P2.11 · Decisions 0045 (object endpoints and workflows), 0046 (runs, segments and errors) and 0047 (snake_case names). 0001, 0010, 0011, 0022, 0024, 0027 and 0028 are marked superseded with a note on what still holds; 0020, 0021, 0026, 0029, 0030, 0042 and 0043 carry an amendment note; 0044 still fits, with the parked publish becoming a waiting `draft_publish` run. SYSTEM_DESIGN's core tables, §1 to §4.10, the walkthroughs, agent tools and glossary describe the model, using snake_case names throughout; the package READMEs still describe the code as it is and change with their tasks. `approvals.subject` becomes `run | draft`.
- 2026-11-09 · P2.12 · New `runs` and `run_steps`; every action call writes a run with one step whose `step_id` is the action's name, and `audit_log` and `event_log` carry `run_id` and `step_id` (a uuid of the `run_steps` row, so history points at the exact attempt). A success's run and step are inserted in its transaction, as `action_log` was, so the retry-key index still makes a concurrent repeat wait and replay; a failure's are written after the rollback. `pending_approval` is now the run status `waiting`, `approvals.subject` is `run`, and `drafts.publish_run_id` replaces `publish_action_id`; a resumed run gets its step row when it runs. `action_log`, `audit_log.action_id` and `event_log.action_id` stay, nullable and unwritten, for P2.26 to drop. The log reads are `run.list` and `run.get` (with steps); `auditLog.list` and `eventLog.list` filter by `runId`; HTTP, MCP and `pipeline.run` return `runId` instead of `actionId`. Activity → Actions is Activity → Runs. Migrations can't carry data, so changes made before runs have no run and drop out of history and the change log in old dev databases; tests build from migrations, so they're unaffected. Checked in the browser on ports 4100 and 3100: the seed's `deal.create` run shows its step, change and event.
- 2026-11-09 · P2.13 · `objectEndpoints(object)` lists each object's REST endpoints (`GET /<plural>`, `GET`/`PATCH /<plural>/{id}`, `POST /<plural>`, `POST …/{id}/archive` and `/restore`, `GET …/{id}/history`), each running the generated action or query of the same name; `System.endpoints` carries them to the API, OpenAPI (tagged by object, `201` on create) and `system_describe` (per object, filtered by what the caller may run). A job a hand-written action owns has no endpoint, so `POST /deals` waits for P2.25 and the web app's new-deal form still posts to `/actions/deal_create`. List filters go in `?filter=` as JSON and `expand` is comma-separated; a get sends `ETag: "<version>"` and `PATCH` reads `If-Match`. Each object gets `<object>_history`; `record.history` stays until P2.26. Generated actions, queries and events, the CRM's config keys and choice options are snake_case, `validateConfig` refuses other keys, and the name patterns accept snake_case or the dotted names hand-written code keeps. The contract tests run every action and generated query over REST, `/actions` and MCP. `/actions` operation ids gained an `actions.` or `queries.` prefix so the REST ones can take the plain name. Field keys stay camelCase for P2.13a. Checked in the browser on ports 4100 and 3100: an organisation's list, record, edit, history, archive and restore all went over REST.
- 2026-11-09 · P2.14 · Role files are `objects: { <object> | "*": { endpoints, rows, read?, write? } }` and `workflows` (names, or `"*"`); hand-written actions and queries are granted under `workflows` until they become workflows. Roles add up per object (endpoints and fields joined, `all` rows win); an agent with roles of its own gets the intersection with its person's, and `own` means the person. `defineObject` takes `owner` (a ref to an actor); `actions.update.readOnly` is gone. The data access layer applies the caller's read rules to list, get, related records and history (a non-own get is `not_found`, history redacts `before` and `after`), and a list refuses a filter or sort on an unreadable field. The repository applies write rules only for object endpoints: an unwritable field is a validation error naming it, a row outside scope a permission error naming the record, and a create under `own` sets the owner to the caller and refuses anyone else. Generated outputs make fields optional so they can be redacted; events keep the whole record. `validateConfig` checks objects, endpoints (a job a hand-written action owns has none), owner fields for `rows: own`, field names and workflow names. The identity actions keep the privilege ceiling through `ctx.grantsBeyond(roles)`; `actor.setRoles` checks the roles taken away too. `system_describe` gives each field's `read` and `write` and each object's `owner` and `rows`; the web app hides unreadable fields and leaves unwritable ones out of generated forms, and Access → Roles and the role editor show the new shape. The CRM: organisations and deals have owners, sales reach only their own deals, nobody writes `deal.stage` or `contact.organisation` directly, and managers can invite and set roles. Surprise: hand-written `deal_create` and `deal.moveStage` write with full access, so `deal_create` now defaults the owner to the caller's person (refusing another for `rows: own`) and `deal.moveStage` reads the deal through the caller's rules first; P2.25 replaces both with workflows.
