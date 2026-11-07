# Decision records

One file per settled decision. To change a decision, add a new record that supersedes the old one; do not edit history.

| # | Decision | Status |
| --- | --- | --- |
| 0001 | [One action registry, many surfaces](0001-one-action-registry.md) | Accepted |
| 0002 | [One instance per client](0002-one-instance-per-client.md) | Accepted |
| 0003 | [Config is files in git](0003-config-as-files-in-git.md) | Accepted |
| 0004 | [Trunk-based development with a production branch](0004-trunk-based-with-production-branch.md) | Accepted |
| 0005 | [Objects are defined once with defineObject](0005-objects-with-defineobject.md) | Accepted |
| 0006 | [Choice fields: system, mapped, custom](0006-choice-fields.md) | Accepted |
| 0007 | [Field history in the repository, not triggers](0007-audit-log-in-repository.md) | Accepted |
| 0008 | [Plain TypeScript; Effect deferred](0008-plain-typescript-effect-deferred.md) | Accepted |
| 0009 | [Mid and back-end systems only](0009-mid-and-back-end-scope.md) | Accepted |
| 0010 | [Workflows are the only listeners; every side effect is an action](0010-workflows-only-listeners.md) | Accepted |
| 0011 | [Who actions run as](0011-who-actions-run-as.md) | Accepted |
| 0012 | [Ultracite for linting and formatting](0012-ultracite-for-lint-and-format.md) | Accepted |
| 0013 | [Marking a migration as the contract step](0013-contract-step-marker.md) | Accepted |
| 0014 | [How field types store and filter values](0014-field-types.md) | Accepted |
| 0015 | [defineObject's tables, records and registry](0015-define-object-tables-and-records.md) | Accepted |
| 0016 | [What the schema check compares](0016-schema-check.md) | Accepted |
| 0017 | [How the data access layer lists, pages and follows refs](0017-data-access-layer.md) | Accepted |
| 0018 | [One `audit_log` row per record change](0018-audit-log-row-per-change.md) | Accepted |
| 0019 | [`defineAction`, the handler context and typed errors](0019-define-action-context-and-errors.md) | Accepted |
| 0020 | [How the action pipeline runs and records](0020-action-pipeline.md) | Accepted |

## Template

```markdown
# NNNN. Title

- **Status:** Proposed | Accepted | Superseded by NNNN
- **Date:** YYYY-MM-DD

## Context

## Decision

## Consequences
```
