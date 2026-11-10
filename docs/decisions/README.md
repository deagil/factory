# Decision records

One file per settled decision. To change a decision, add a new record that supersedes the old one; do not edit history.

| # | Decision | Status |
| --- | --- | --- |
| 0001 | [One action registry, many surfaces](0001-one-action-registry.md) | Superseded by [0045](0045-object-endpoints-and-workflows.md) |
| 0002 | [One instance per client](0002-one-instance-per-client.md) | Accepted |
| 0003 | [Config is files in git](0003-config-as-files-in-git.md) | Accepted |
| 0004 | [Trunk-based development with a production branch](0004-trunk-based-with-production-branch.md) | Accepted |
| 0005 | [Objects are defined once with defineObject](0005-objects-with-defineobject.md) | Accepted |
| 0006 | [Choice fields: system, mapped, custom](0006-choice-fields.md) | Accepted |
| 0007 | [Field history in the repository, not triggers](0007-audit-log-in-repository.md) | Accepted |
| 0008 | [Plain TypeScript; Effect deferred](0008-plain-typescript-effect-deferred.md) | Accepted |
| 0009 | [Mid and back-end systems only](0009-mid-and-back-end-scope.md) | Accepted |
| 0010 | [Workflows are the only listeners; every side effect is an action](0010-workflows-only-listeners.md) | Superseded by [0045](0045-object-endpoints-and-workflows.md) |
| 0011 | [Who actions run as](0011-who-actions-run-as.md) | Superseded by [0045](0045-object-endpoints-and-workflows.md) |
| 0012 | [Ultracite for linting and formatting](0012-ultracite-for-lint-and-format.md) | Accepted |
| 0013 | [Marking a migration as the contract step](0013-contract-step-marker.md) | Accepted |
| 0014 | [How field types store and filter values](0014-field-types.md) | Accepted; amended by [0052](0052-computed-and-display-fields.md) |
| 0015 | [defineObject's tables, records and registry](0015-define-object-tables-and-records.md) | Accepted |
| 0016 | [What the schema check compares](0016-schema-check.md) | Accepted |
| 0017 | [How the data access layer lists, pages and follows refs](0017-data-access-layer.md) | Accepted |
| 0018 | [One `audit_log` row per record change](0018-audit-log-row-per-change.md) | Accepted |
| 0019 | [`defineAction`, the handler context and typed errors](0019-define-action-context-and-errors.md) | Accepted |
| 0020 | [How the action pipeline runs and records](0020-action-pipeline.md) | Accepted |
| 0021 | [Retry keys and dry runs](0021-retry-keys-and-dry-runs.md) | Accepted |
| 0022 | [The shape of generated actions and queries](0022-generated-actions.md) | Superseded by [0045](0045-object-endpoints-and-workflows.md) |
| 0023 | [Sign-in with Better Auth, and where its tables live](0023-sign-in-with-better-auth.md) | Accepted |
| 0024 | [How roles grant permissions](0024-roles-and-permissions.md) | Superseded by [0045](0045-object-endpoints-and-workflows.md) |
| 0025 | [API keys, agents and integrations](0025-api-keys-agents-and-integrations.md) | Accepted |
| 0026 | [API transport: our own generator on Hono](0026-api-transport-own-generator-on-hono.md) | Accepted |
| 0027 | [The HTTP API's shape](0027-http-api-shape.md) | Superseded by [0045](0045-object-endpoints-and-workflows.md) |
| 0028 | [MCP tools](0028-mcp-tools.md) | Superseded by [0045](0045-object-endpoints-and-workflows.md) and [0047](0047-snake-case-names.md) |
| 0029 | [`system.describe`](0029-system-describe.md) | Accepted |
| 0030 | [Contract tests across surfaces](0030-contract-tests-across-surfaces.md) | Accepted |
| 0031 | [`defineSystem`, `createServer` and running a system](0031-define-system-and-create-server.md) | Accepted |
| 0032 | [How the web app reaches the API](0032-web-app-reaches-the-api.md) | Accepted |
| 0033 | [Web navigation by section, and what the dev bar is for](0033-web-navigation-and-dev-bar.md) | Accepted; amended by [0049](0049-navigation-lists-categories.md), [0051](0051-breadcrumb-omits-the-section.md) and [0058](0058-page-context-and-links-for-the-agent.md) |
| 0034 | [Inviting people, setting roles, and disabling actors](0034-inviting-and-disabling-people.md) | Accepted |
| 0035 | [Restoring archived records, and archiving in the audit log](0035-restore-and-audited-archiving.md) | Accepted |
| 0036 | [System migrations](0036-system-migrations.md) | Accepted |
| 0037 | [Config files are YAML, one per key](0037-config-files-are-yaml.md) | Accepted |
| 0038 | [The config loader](0038-config-loader.md) | Accepted |
| 0039 | [Choice fields](0039-choice-fields.md) | Accepted |
| 0040 | [Choice lists define their columns](0040-choice-lists-define-their-columns.md) | Accepted |
| 0041 | [Drafts over git](0041-drafts-over-git.md) | Accepted; amended by [0044](0044-working-drafts-and-requests.md) and [0055](0055-saving-config-files-with-a-revision.md) |
| 0042 | [Approval rules](0042-approval-rules.md) | Accepted |
| 0043 | [Approval limits](0043-approval-limits.md) | Accepted |
| 0044 | [Working drafts, and requests that publish when approved](0044-working-drafts-and-requests.md) | Accepted; amended by [0055](0055-saving-config-files-with-a-revision.md) |
| 0045 | [Object endpoints and workflows](0045-object-endpoints-and-workflows.md) | Accepted |
| 0046 | [Runs, segments and errors](0046-runs-segments-and-errors.md) | Accepted |
| 0047 | [One snake_case name on every surface](0047-snake-case-names.md) | Accepted |
| 0048 | [The workflow file and its validation](0048-workflow-file-format.md) | Accepted |
| 0049 | [Navigation lists categories, then the things in them](0049-navigation-lists-categories.md) | Accepted; amended by [0050](0050-approvals-in-the-account-menu.md) and [0051](0051-breadcrumb-omits-the-section.md) |
| 0050 | [Approvals live in the account menu](0050-approvals-in-the-account-menu.md) | Accepted |
| 0051 | [The breadcrumb omits the section](0051-breadcrumb-omits-the-section.md) | Accepted |
| 0052 | [Computed fields, and the display field](0052-computed-and-display-fields.md) | Accepted |
| 0053 | [The workflow editor is an outline of steps](0053-workflow-editor-outline.md) | Accepted |
| 0054 | [Reading workflows over the API](0054-reading-workflows-over-the-api.md) | Accepted |
| 0055 | [Config files are saved whole, with a revision](0055-saving-config-files-with-a-revision.md) | Accepted |
| 0056 | [Step forms come from schemas](0056-step-forms-from-schemas.md) | Accepted |
| 0057 | [Test runs of draft workflows](0057-test-runs-of-draft-workflows.md) | Accepted |
| 0058 | [Page context and links for the in-app agent](0058-page-context-and-links-for-the-agent.md) | Accepted |

## Template

```markdown
# NNNN. Title

- **Status:** Proposed | Accepted | Superseded by NNNN
- **Date:** YYYY-MM-DD

## Context

## Decision

## Consequences
```
