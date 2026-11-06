# Branch protection

`main` takes changes only through pull requests with green CI. Nobody pushes to it directly, people and agents included. `production` gets the same rule in phase 3, with only the release bot allowed to write to it. This is the enforcement half of SYSTEM_DESIGN §6, Guardrails; `fx ship` is the other half.

Set it up once per repo, on the git host. It needs admin rights there, so it's the repo owner's job, not an agent's.

## What to enforce on `main`

| Rule | Why |
| --- | --- |
| No direct pushes; changes arrive by PR | Every change is reviewed by CI before it lands |
| The `check` status must pass | `check` is the CI job in `.github/workflows/ci.yml`: typecheck, lint, tests, migration lint, migrations on a fresh database |
| The branch must be up to date with `main` | CI tested what will actually land. `fx ship` rebases, so this costs nothing |
| Squash merges only | One commit per change on `main`, titled with the PR's conventional-commit title |
| No force pushes, no deletion | `main`'s history is what staging and releases are built from |

## GitHub

Branch protection and rulesets are free on public repos. Private repos need GitHub Pro, Team or Enterprise. On GitHub Free the API answers `403: Upgrade to GitHub Pro or make this repository public`, and nothing can be enforced.

### With the API

Run this as a repo admin. It creates one ruleset for the default branch:

```bash
gh api --method POST repos/OWNER/REPO/rulesets --input - <<'EOF'
{
  "name": "main",
  "target": "branch",
  "enforcement": "active",
  "conditions": { "ref_name": { "include": ["~DEFAULT_BRANCH"], "exclude": [] } },
  "rules": [
    { "type": "deletion" },
    { "type": "non_fast_forward" },
    {
      "type": "pull_request",
      "parameters": {
        "required_approving_review_count": 0,
        "dismiss_stale_reviews_on_push": false,
        "require_code_owner_review": false,
        "require_last_push_approval": false,
        "required_review_thread_resolution": false,
        "allowed_merge_methods": ["squash"]
      }
    },
    {
      "type": "required_status_checks",
      "parameters": {
        "strict_required_status_checks_policy": true,
        "required_status_checks": [{ "context": "check" }]
      }
    }
  ]
}
EOF
```

`required_approving_review_count` is 0 because CI is the reviewer for now. Raise it when a second person joins.

### In the web UI

Settings → Rules → Rulesets → New branch ruleset:

1. Name it `main`, set enforcement to **Active**, and target the default branch.
2. Tick **Restrict deletions** and **Block force pushes**.
3. Tick **Require a pull request before merging**, with 0 approvals, and allow only **Squash** merges.
4. Tick **Require status checks to pass**, then **Require branches to be up to date before merging**, and add the `check` status.

Also, under Settings → General → Pull Requests, allow only squash merging and use the PR title as the default commit message.

## Other git hosts

The same rules apply; only the names differ.

- **GitLab:** Settings → Repository → Protected branches: protect `main` with **Allowed to push and merge: No one** and **Allowed to merge: Maintainers**. Then under Settings → Merge requests, tick **Pipelines must succeed**, and set the merge method to **Fast-forward merge** with squashing required. GitLab CI needs its own pipeline file running the same steps as `ci.yml`.
- **Gitea and Forgejo:** Settings → Branches → Add rule for `main`. Disable pushes, enable status checks with the CI job's name, tick **Block merge on outdated branch**, and allow only squash merges in the repo's settings.
- **A plain git server** (SSH, no pull requests): only the merge bot's account may update `main`. With gitolite:

  ```
  repo factory
      RW+ main            = merge-bot
      -   main            = @all
      RW+ change/         = @developers
  ```

  For any other server, add a `pre-receive` hook that refuses updates to `refs/heads/main` from everyone except the bot.

## Checking it works

From any checkout, try to push a commit straight to `main`:

```bash
git commit --allow-empty -m "test: direct push"
git push origin HEAD:main
```

The host must refuse it. GitHub answers `GH013: Repository rule violations found`. Then remove the test commit; `--soft` leaves any other work alone:

```bash
git reset --soft HEAD~1
```
